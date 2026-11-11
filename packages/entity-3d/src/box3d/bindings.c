// The only functions JavaScript calls. Every input and output is a plain number, because wasm can't
// pass structs to JavaScript. Results bigger than one number go into `output`, which JavaScript
// reads straight out of wasm memory.
#include <emscripten/em_js.h>
#include <emscripten/emscripten.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "box3d/box3d.h"
#include "box3d/constants.h"

// Box3D only saves and restores a whole world through these internals, which its replay uses.
#include "core.h"
#include "physics_world.h"
#include "recording.h"
#include "recording_replay.h"
#include "shape.h"
#include "world_snapshot.h"

static void* output = NULL;
static int outputCapacity = 0;

// The returned buffer is only valid until the next call that writes output.
static void* reserveOutput( int byteCount )
{
	if ( byteCount > outputCapacity )
	{
		outputCapacity = byteCount * 2;
		output = realloc( output, outputCapacity );
	}
	return output;
}

// Body and joint ids are 8 bytes, more than one JavaScript number holds exactly, so they cross as
// two numbers.
static uint64_t loadId( int32_t index, int32_t tag )
{
	return ( (uint64_t)(uint32_t)index << 32 ) | (uint32_t)tag;
}

static b3BodyId loadBodyId( int32_t index, int32_t tag )
{
	return b3LoadBodyId( loadId( index, tag ) );
}

static b3JointId loadJointId( int32_t index, int32_t tag )
{
	return b3LoadJointId( loadId( index, tag ) );
}

static int32_t* writeId( uint64_t stored )
{
	int32_t* ids = reserveOutput( 2 * sizeof( int32_t ) );
	ids[0] = (int32_t)( stored >> 32 );
	ids[1] = (int32_t)( stored & 0xFFFFFFFF );
	return ids;
}

static void* input = NULL;
static int inputCapacity = 0;

// JavaScript writes array inputs (hull points, mesh triangles, heights) here before calling the
// function that reads them.
EMSCRIPTEN_KEEPALIVE void* reserveInput( int byteCount )
{
	if ( byteCount > inputCapacity )
	{
		inputCapacity = byteCount * 2;
		input = realloc( input, inputCapacity );
	}
	return input;
}

// Mesh, height field, and compound shapes keep pointing at their geometry instead of copying it, so
// it is freed here once its shapes, body, or world are destroyed.
typedef struct OwnedGeometry
{
	uint64_t bodyId;
	uint16_t world;
	void* mesh;
	void* heightField;
	void* compound;
} OwnedGeometry;

static OwnedGeometry* ownedGeometry = NULL;
static int ownedGeometryCount = 0;
static int ownedGeometryCapacity = 0;

static void ownGeometry( b3BodyId bodyId, b3MeshData* mesh, b3HeightFieldData* heightField, b3CompoundData* compound )
{
	if ( ownedGeometryCount == ownedGeometryCapacity )
	{
		ownedGeometryCapacity = ownedGeometryCapacity ? ownedGeometryCapacity * 2 : 8;
		ownedGeometry = realloc( ownedGeometry, ownedGeometryCapacity * sizeof( OwnedGeometry ) );
	}
	ownedGeometry[ownedGeometryCount++] = ( OwnedGeometry ){ b3StoreBodyId( bodyId ), bodyId.world0, mesh, heightField, compound };
}

static void freeGeometry( bool ( *matches )( const OwnedGeometry*, uint64_t ), uint64_t key )
{
	int keptCount = 0;
	for ( int index = 0; index < ownedGeometryCount; ++index )
	{
		OwnedGeometry* owned = ownedGeometry + index;
		if ( matches( owned, key ) )
		{
			if ( owned->mesh )
			{
				b3DestroyMesh( owned->mesh );
			}
			if ( owned->heightField )
			{
				b3DestroyHeightField( owned->heightField );
			}
			if ( owned->compound )
			{
				b3DestroyCompound( owned->compound );
			}
		}
		else
		{
			ownedGeometry[keptCount++] = *owned;
		}
	}
	ownedGeometryCount = keptCount;
}

static bool isOwnedByBody( const OwnedGeometry* owned, uint64_t bodyId )
{
	return owned->bodyId == bodyId;
}

static bool isOwnedByWorld( const OwnedGeometry* owned, uint64_t world )
{
	return owned->world == b3LoadWorldId( (uint32_t)world ).index1 - 1;
}

// What pre-solve needs to know about each shape. Shapes only collide with things on the side their
// one-way direction (in the body's frame) points to.
typedef struct TrackedShape
{
	uint16_t generation;
	bool isOneWay;
	bool enablePreSolve;
	b3Vec3 direction;
} TrackedShape;

// A one-way shape and a shape that touched it from the wrong side. They don't collide until they
// stop touching, so that a body passing through doesn't get pushed out the far side once it's
// mostly through.
typedef struct PassingPair
{
	b3ShapeId oneWayShape;
	b3ShapeId otherShape;
	bool isTouching;
} PassingPair;

typedef struct TrackedWorld
{
	TrackedShape* shapes;
	int shapeCapacity;
	PassingPair* passingPairs;
	int passingCount;
	int passingCapacity;
	bool hasPreSolveHook;
	bool hasOtherHooks;
	b3Recording* recording;
} TrackedWorld;

static TrackedWorld trackedWorlds[B3_MAX_WORLDS];

static const TrackedShape* findShape( b3ShapeId shapeId )
{
	TrackedWorld* world = trackedWorlds + shapeId.world0;
	int index = shapeId.index1 - 1;
	if ( index >= world->shapeCapacity )
	{
		return NULL;
	}
	const TrackedShape* shape = world->shapes + index;
	return shape->generation == shapeId.generation ? shape : NULL;
}

static const TrackedShape* findOneWayShape( b3ShapeId shapeId )
{
	const TrackedShape* shape = findShape( shapeId );
	return shape && shape->isOneWay ? shape : NULL;
}

static bool allowsOneWayContact( b3ShapeId shapeIdA, b3ShapeId shapeIdB, b3Vec3 normal )
{
	const TrackedShape* oneWayA = findOneWayShape( shapeIdA );
	const TrackedShape* oneWayB = findOneWayShape( shapeIdB );
	if ( !oneWayA && !oneWayB )
	{
		return true;
	}
	b3ShapeId oneWayShape = oneWayA ? shapeIdA : shapeIdB;
	b3ShapeId otherShape = oneWayA ? shapeIdB : shapeIdA;
	// the normal points from shape A to shape B, so this points from the one-way shape to the other
	b3Vec3 towardOther = oneWayA ? normal : b3Neg( normal );
	TrackedWorld* world = trackedWorlds + shapeIdA.world0;
	for ( int index = 0; index < world->passingCount; ++index )
	{
		PassingPair* pair = world->passingPairs + index;
		if ( B3_ID_EQUALS( pair->oneWayShape, oneWayShape ) && B3_ID_EQUALS( pair->otherShape, otherShape ) )
		{
			pair->isTouching = true;
			return false;
		}
	}
	b3Quat rotation = b3Body_GetRotation( b3Shape_GetBody( oneWayShape ) );
	b3Vec3 direction = b3RotateVector( rotation, ( oneWayA ? oneWayA : oneWayB )->direction );
	if ( b3Dot( towardOther, direction ) > 0.0f )
	{
		return true;
	}
	if ( world->passingCount == world->passingCapacity )
	{
		world->passingCapacity = world->passingCapacity ? world->passingCapacity * 2 : 8;
		world->passingPairs = realloc( world->passingPairs, world->passingCapacity * sizeof( PassingPair ) );
	}
	world->passingPairs[world->passingCount++] = ( PassingPair ){ oneWayShape, otherShape, true };
	return false;
}

static int32_t shapeEntity( b3ShapeId shapeId )
{
	return (int32_t)(intptr_t)b3Shape_GetUserData( shapeId );
}

// `Module` here is the module object the Box3D factory resolves to, which JavaScript gives a map
// from world id to that world's hooks.
EM_JS( bool, callCustomFilter, ( uint32_t world, int32_t entityA, int32_t entityB ), {
	return Module.anthaWorldHooks.get( world )().customFilter( { entityA, entityB } );
} );

EM_JS( bool, callPreSolve,
	   ( uint32_t world, int32_t entityA, int32_t entityB, float pointX, float pointY, float pointZ, float normalX,
		 float normalY, float normalZ ),
	   {
		   return Module.anthaWorldHooks.get( world )().preSolve( {
			   entityA,
			   entityB,
			   point : { x : pointX, y : pointY, z : pointZ },
			   normal : { x : normalX, y : normalY, z : normalZ },
		   } );
	   } );

EM_JS( float, callMixFriction, ( uint32_t world, float frictionA, int32_t idA, float frictionB, int32_t idB ), {
	return Module.anthaWorldHooks.get( world )().mixFriction( { value : frictionA, userMaterialId : idA },
															  { value : frictionB, userMaterialId : idB } );
} );

EM_JS( float, callMixRestitution,
	   ( uint32_t world, float restitutionA, int32_t idA, float restitutionB, int32_t idB ), {
		   return Module.anthaWorldHooks.get( world )().mixRestitution( { value : restitutionA, userMaterialId : idA },
																		{ value : restitutionB, userMaterialId : idB } );
	   } );

// Box3D calls this for continuous collision too, with the same normal direction. `context` is the
// world id.
static bool preSolve( b3ShapeId shapeIdA, b3ShapeId shapeIdB, b3Pos point, b3Vec3 normal, void* context )
{
	if ( !allowsOneWayContact( shapeIdA, shapeIdB, normal ) )
	{
		return false;
	}
	if ( !trackedWorlds[shapeIdA.world0].hasPreSolveHook )
	{
		return true;
	}
	const TrackedShape* shapeA = findShape( shapeIdA );
	const TrackedShape* shapeB = findShape( shapeIdB );
	if ( !( shapeA && shapeA->enablePreSolve ) && !( shapeB && shapeB->enablePreSolve ) )
	{
		return true;
	}
	return callPreSolve( (uint32_t)(uintptr_t)context, shapeEntity( shapeIdA ), shapeEntity( shapeIdB ), point.x,
						 point.y, point.z, normal.x, normal.y, normal.z );
}

static bool customFilter( b3ShapeId shapeIdA, b3ShapeId shapeIdB, void* context )
{
	return callCustomFilter( (uint32_t)(uintptr_t)context, shapeEntity( shapeIdA ), shapeEntity( shapeIdB ) );
}

// Box3D only mixes materials inside `b3World_Step`, and doesn't pass the mixers a context.
static uint32_t steppingWorld;

static float mixFriction( float frictionA, uint64_t idA, float frictionB, uint64_t idB )
{
	return callMixFriction( steppingWorld, frictionA, (int32_t)idA, frictionB, (int32_t)idB );
}

static float mixRestitution( float restitutionA, uint64_t idA, float restitutionB, uint64_t idB )
{
	return callMixRestitution( steppingWorld, restitutionA, (int32_t)idA, restitutionB, (int32_t)idB );
}

// Drops the passing pairs that no pre-solve call saw since the last call to this, since their shapes
// stopped touching. Box3D runs pre-solve every step for touching contacts on bodies without contact
// recycling, which `recordShape` turns off.
static void forgetSeparatedPairs( b3WorldId worldId )
{
	TrackedWorld* world = trackedWorlds + worldId.index1 - 1;
	int keptCount = 0;
	for ( int index = 0; index < world->passingCount; ++index )
	{
		PassingPair pair = world->passingPairs[index];
		if ( pair.isTouching )
		{
			pair.isTouching = false;
			world->passingPairs[keptCount++] = pair;
		}
	}
	world->passingCount = keptCount;
}

static void* createDebugShape( const b3DebugShape* debugShape, void* context );
static void destroyDebugShape( void* userShape, void* context );

EMSCRIPTEN_KEEPALIVE uint32_t createWorld( float gravityX, float gravityY, float gravityZ )
{
	b3WorldDef def = b3DefaultWorldDef();
	def.gravity = ( b3Vec3 ){ gravityX, gravityY, gravityZ };
	def.createDebugShape = createDebugShape;
	def.destroyDebugShape = destroyDebugShape;
	b3WorldId worldId = b3CreateWorld( &def );
	uint32_t world = b3StoreWorldId( worldId );
	b3World_SetPreSolveCallback( worldId, preSolve, (void*)(uintptr_t)world );
	return world;
}

// Turns each world hook on or off. Pre-solve stays on for one-way shapes either way.
EMSCRIPTEN_KEEPALIVE void setHooks( uint32_t world, bool enableCustomFilter, bool enablePreSolve,
									bool enableMixFriction, bool enableMixRestitution )
{
	b3WorldId worldId = b3LoadWorldId( world );
	b3World_SetCustomFilterCallback( worldId, enableCustomFilter ? customFilter : NULL, (void*)(uintptr_t)world );
	b3World_SetFrictionCallback( worldId, enableMixFriction ? mixFriction : NULL );
	b3World_SetRestitutionCallback( worldId, enableMixRestitution ? mixRestitution : NULL );
	trackedWorlds[worldId.index1 - 1].hasPreSolveHook = enablePreSolve;
	trackedWorlds[worldId.index1 - 1].hasOtherHooks = enableCustomFilter || enableMixFriction || enableMixRestitution;
}

EMSCRIPTEN_KEEPALIVE void destroyWorld( uint32_t world )
{
	b3WorldId worldId = b3LoadWorldId( world );
	TrackedWorld* trackedWorld = trackedWorlds + worldId.index1 - 1;
	if ( trackedWorld->recording )
	{
		b3World_StopRecording( worldId );
		b3DestroyRecording( trackedWorld->recording );
	}
	free( trackedWorld->shapes );
	free( trackedWorld->passingPairs );
	*trackedWorld = ( TrackedWorld ){ 0 };
	b3DestroyWorld( worldId );
	freeGeometry( isOwnedByWorld, world );
}

EMSCRIPTEN_KEEPALIVE void setGravity( uint32_t world, float x, float y, float z )
{
	b3World_SetGravity( b3LoadWorldId( world ), ( b3Vec3 ){ x, y, z } );
}

// Writes six counts (contact begin, contact end, sensor begin, sensor end, hit, strained joint), then
// the entity id pair of each contact begin, contact end, sensor begin, and sensor end event (sensor
// first), then each hit as its entity id pair followed by point x, y, z, normal x, y, z (from the
// first entity toward the second), and approach speed as floats, then the id JavaScript gave each
// joint that passed its force or torque threshold.
EMSCRIPTEN_KEEPALIVE int32_t* step( uint32_t world, float seconds, int subSteps )
{
	b3WorldId worldId = b3LoadWorldId( world );
	steppingWorld = world;
	b3World_Step( worldId, seconds, subSteps );
	forgetSeparatedPairs( worldId );
	b3ContactEvents contacts = b3World_GetContactEvents( worldId );
	b3SensorEvents sensors = b3World_GetSensorEvents( worldId );
	b3JointEvents joints = b3World_GetJointEvents( worldId );
	int pairCapacity = contacts.beginCount + contacts.endCount + sensors.beginCount + sensors.endCount;
	int32_t* written =
		reserveOutput( ( 6 + 2 * pairCapacity + 9 * contacts.hitCount + joints.count ) * sizeof( int32_t ) );
	int32_t* next = written + 6;
	for ( int index = 0; index < contacts.beginCount; ++index )
	{
		*next++ = shapeEntity( contacts.beginEvents[index].shapeIdA );
		*next++ = shapeEntity( contacts.beginEvents[index].shapeIdB );
	}
	int contactEndCount = 0;
	for ( int index = 0; index < contacts.endCount; ++index )
	{
		b3ShapeId shapeA = contacts.endEvents[index].shapeIdA;
		b3ShapeId shapeB = contacts.endEvents[index].shapeIdB;
		// end events also fire for shapes destroyed since the last step
		if ( b3Shape_IsValid( shapeA ) && b3Shape_IsValid( shapeB ) )
		{
			*next++ = shapeEntity( shapeA );
			*next++ = shapeEntity( shapeB );
			++contactEndCount;
		}
	}
	for ( int index = 0; index < sensors.beginCount; ++index )
	{
		*next++ = shapeEntity( sensors.beginEvents[index].sensorShapeId );
		*next++ = shapeEntity( sensors.beginEvents[index].visitorShapeId );
	}
	int sensorEndCount = 0;
	for ( int index = 0; index < sensors.endCount; ++index )
	{
		b3ShapeId sensorShape = sensors.endEvents[index].sensorShapeId;
		b3ShapeId visitorShape = sensors.endEvents[index].visitorShapeId;
		if ( b3Shape_IsValid( sensorShape ) && b3Shape_IsValid( visitorShape ) )
		{
			*next++ = shapeEntity( sensorShape );
			*next++ = shapeEntity( visitorShape );
			++sensorEndCount;
		}
	}
	int hitCount = 0;
	for ( int index = 0; index < contacts.hitCount; ++index )
	{
		b3ContactHitEvent* hit = contacts.hitEvents + index;
		if ( !b3Shape_IsValid( hit->shapeIdA ) || !b3Shape_IsValid( hit->shapeIdB ) )
		{
			continue;
		}
		*next++ = shapeEntity( hit->shapeIdA );
		*next++ = shapeEntity( hit->shapeIdB );
		float* numbers = (float*)next;
		numbers[0] = hit->point.x;
		numbers[1] = hit->point.y;
		numbers[2] = hit->point.z;
		numbers[3] = hit->normal.x;
		numbers[4] = hit->normal.y;
		numbers[5] = hit->normal.z;
		numbers[6] = hit->approachSpeed;
		next += 7;
		++hitCount;
	}
	written[0] = contacts.beginCount;
	written[1] = contactEndCount;
	written[2] = sensors.beginCount;
	written[3] = sensorEndCount;
	written[4] = hitCount;
	written[5] = joints.count;
	for ( int index = 0; index < joints.count; ++index )
	{
		*next++ = (int32_t)(intptr_t)joints.jointEvents[index].userData;
	}
	return written;
}

EMSCRIPTEN_KEEPALIVE void setHitEventThreshold( uint32_t world, float speed )
{
	b3World_SetHitEventThreshold( b3LoadWorldId( world ), speed );
}

// Settings are in `worldSettingsTemplate`'s order in physics.ts, with booleans inverted where the
// template names them for being disabled.
EMSCRIPTEN_KEEPALIVE float* readDefaultWorldSettings( void )
{
	b3WorldDef def = b3DefaultWorldDef();
	float* settings = reserveOutput( 9 * sizeof( float ) );
	settings[0] = def.restitutionThreshold;
	settings[1] = def.contactHertz;
	settings[2] = def.contactDampingRatio;
	settings[3] = def.contactSpeed;
	settings[4] = def.maximumLinearSpeed;
	settings[5] = B3_CONTACT_RECYCLE_DISTANCE;
	settings[6] = !def.enableSleep;
	settings[7] = !def.enableContinuous;
	settings[8] = 0;
	return settings;
}

EMSCRIPTEN_KEEPALIVE void setWorldSettings( uint32_t world )
{
	b3WorldId worldId = b3LoadWorldId( world );
	float* settings = input;
	b3World_SetRestitutionThreshold( worldId, settings[0] );
	b3World_SetContactTuning( worldId, settings[1], settings[2], settings[3] );
	b3World_SetMaximumLinearSpeed( worldId, settings[4] );
	b3World_SetContactRecycleDistance( worldId, settings[5] );
	b3World_EnableSleeping( worldId, settings[6] == 0 );
	b3World_EnableContinuous( worldId, settings[7] == 0 );
	b3World_EnableWarmStarting( worldId, settings[8] == 0 );
}

// Motion locks cross as bits: linear x, y, z, then angular x, y, z, from the lowest bit up.
static b3MotionLocks loadMotionLocks( int bits )
{
	return ( b3MotionLocks ){ bits & 1, bits & 2, bits & 4, bits & 8, bits & 16, bits & 32 };
}

// Writes the new body's id as two numbers.
EMSCRIPTEN_KEEPALIVE int32_t* createBody( uint32_t world, int type, float x, float y, float z, float rotationX,
										 float rotationY, float rotationZ, float rotationW, float velocityX, float velocityY,
										 float velocityZ, float angularVelocityX, float angularVelocityY,
										 float angularVelocityZ, float linearDamping, float angularDamping, float gravityScale,
										 int motionLocks, bool isBullet, bool isEnabled, bool enableSleep,
										 float sleepThreshold, int32_t entityId )
{
	b3BodyDef def = b3DefaultBodyDef();
	def.type = (b3BodyType)type;
	def.position = ( b3Pos ){ x, y, z };
	def.rotation = ( b3Quat ){ { rotationX, rotationY, rotationZ }, rotationW };
	def.linearVelocity = ( b3Vec3 ){ velocityX, velocityY, velocityZ };
	def.angularVelocity = ( b3Vec3 ){ angularVelocityX, angularVelocityY, angularVelocityZ };
	def.linearDamping = linearDamping;
	def.angularDamping = angularDamping;
	def.gravityScale = gravityScale;
	def.motionLocks = loadMotionLocks( motionLocks );
	def.isBullet = isBullet;
	def.isEnabled = isEnabled;
	def.enableSleep = enableSleep;
	if ( !isnan( sleepThreshold ) )
	{
		def.sleepThreshold = sleepThreshold;
	}
	def.userData = (void*)(intptr_t)entityId;
	return writeId( b3StoreBodyId( b3CreateBody( b3LoadWorldId( world ), &def ) ) );
}

EMSCRIPTEN_KEEPALIVE void destroyBody( int32_t index, int32_t tag )
{
	b3BodyId bodyId = loadBodyId( index, tag );
	if ( b3Body_IsValid( bodyId ) )
	{
		b3DestroyBody( bodyId );
		freeGeometry( isOwnedByBody, b3StoreBodyId( bodyId ) );
	}
}

// Reads friction, restitution, rolling resistance, tangent velocity x, y, z, and user material id.
// NaN keeps that value from `fallback`, and a NaN tangent velocity x keeps the whole tangent
// velocity.
static b3SurfaceMaterial loadSurfaceMaterial( const float* values, b3SurfaceMaterial fallback )
{
	b3SurfaceMaterial material = fallback;
	if ( !isnan( values[0] ) )
	{
		material.friction = values[0];
	}
	if ( !isnan( values[1] ) )
	{
		material.restitution = values[1];
	}
	if ( !isnan( values[2] ) )
	{
		material.rollingResistance = values[2];
	}
	if ( !isnan( values[3] ) )
	{
		material.tangentVelocity = ( b3Vec3 ){ values[3], values[4], values[5] };
	}
	if ( !isnan( values[6] ) )
	{
		material.userMaterialId = (uint64_t)values[6];
	}
	return material;
}

static b3ShapeDef shapeDef;
static TrackedShape trackedShape;

// Sets up the shape definition the next `add*` calls use. NaN keeps Box3D's default for a material
// value or the explosion scale, and a NaN one-way direction makes shapes collide from every side.
// A NaN tangent velocity x keeps the whole default tangent velocity.
EMSCRIPTEN_KEEPALIVE void setShapeDefinition( uint64_t category, uint64_t mask, int32_t groupIndex, int32_t entityId,
											  float density, float friction, float restitution,
											  float rollingResistance, float tangentVelocityX, float tangentVelocityY,
											  float tangentVelocityZ, float userMaterialId, float explosionScale,
											  bool isSensor, bool enableHitEvents, bool enableCustomFiltering,
											  bool enablePreSolve, float oneWayX, float oneWayY, float oneWayZ )
{
	shapeDef = b3DefaultShapeDef();
	bool isOneWay = !isnan( oneWayX );
	trackedShape = ( TrackedShape ){ 0, isOneWay, enablePreSolve, { oneWayX, oneWayY, oneWayZ } };
	shapeDef.enablePreSolveEvents = isOneWay || enablePreSolve;
	shapeDef.enableCustomFiltering = enableCustomFiltering;
	shapeDef.filter.categoryBits = category;
	shapeDef.filter.maskBits = mask;
	shapeDef.filter.groupIndex = groupIndex;
	shapeDef.isSensor = isSensor;
	shapeDef.enableSensorEvents = mask != 0;
	shapeDef.enableContactEvents = mask != 0;
	shapeDef.enableHitEvents = enableHitEvents;
	shapeDef.userData = (void*)(intptr_t)entityId;
	if ( !isnan( density ) )
	{
		shapeDef.density = density;
	}
	if ( !isnan( explosionScale ) )
	{
		shapeDef.explosionScale = explosionScale;
	}
	float materialValues[7] = { friction, restitution, rollingResistance, tangentVelocityX, tangentVelocityY,
								tangentVelocityZ, userMaterialId };
	shapeDef.baseMaterial = loadSurfaceMaterial( materialValues, shapeDef.baseMaterial );
}

// Saves what pre-solve needs from the last `setShapeDefinition` call for a new shape. Every shape
// overwrites its slot, since Box3D reuses the slots of destroyed shapes.
static void recordShape( b3BodyId bodyId, b3ShapeId shapeId )
{
	TrackedWorld* world = trackedWorlds + shapeId.world0;
	int index = shapeId.index1 - 1;
	if ( index >= world->shapeCapacity )
	{
		int capacity = world->shapeCapacity ? world->shapeCapacity : 64;
		while ( capacity <= index )
		{
			capacity *= 2;
		}
		world->shapes = realloc( world->shapes, capacity * sizeof( TrackedShape ) );
		memset( world->shapes + world->shapeCapacity, 0, ( capacity - world->shapeCapacity ) * sizeof( TrackedShape ) );
		world->shapeCapacity = capacity;
	}
	world->shapes[index] = trackedShape;
	world->shapes[index].generation = shapeId.generation;
	if ( shapeDef.enablePreSolveEvents )
	{
		// Box3D skips pre-solve for recycled contacts, even ones pre-solve disabled, which would
		// make `forgetSeparatedPairs` drop a pair that is still passing through and keep the
		// pre-solve hook from running every step.
		b3Body_EnableContactRecycling( bodyId, false );
	}
}

static b3Transform loadTransform( float x, float y, float z, float rotationX, float rotationY, float rotationZ,
								  float rotationW )
{
	return ( b3Transform ){ { x, y, z }, { { rotationX, rotationY, rotationZ }, rotationW } };
}

// Standalone geometry queries read their shapes from these instead of a body. The `add*` functions
// fill one instead of adding a shape when given body index -1 (slot 0) or -2 (slot 1), so geometry
// queries take shapes the same way bodies do.
typedef struct GeometrySlot
{
	b3ShapeType type;
	b3Sphere sphere;
	b3Capsule capsule;
	b3BoxHull box;
	// points at `box.base` for boxes
	const b3HullData* hull;
	b3HullData* ownedHull;
	b3MeshData* mesh;
	b3HeightFieldData* heightField;
	b3CompoundData* compound;
} GeometrySlot;

static GeometrySlot geometrySlots[2];

// Empties and returns the slot a negative body index names, or returns NULL for a real body.
static GeometrySlot* takeGeometrySlot( int32_t index )
{
	if ( index >= 0 )
	{
		return NULL;
	}
	GeometrySlot* slot = &geometrySlots[-index - 1];
	if ( slot->ownedHull != NULL )
	{
		b3DestroyHull( slot->ownedHull );
	}
	if ( slot->mesh != NULL )
	{
		b3DestroyMesh( slot->mesh );
	}
	if ( slot->heightField != NULL )
	{
		b3DestroyHeightField( slot->heightField );
	}
	if ( slot->compound != NULL )
	{
		b3DestroyCompound( slot->compound );
	}
	*slot = ( GeometrySlot ){ 0 };
	return slot;
}

EMSCRIPTEN_KEEPALIVE void addSphere( int32_t index, int32_t tag, float centerX, float centerY, float centerZ,
									 float radius )
{
	b3Sphere sphere = { { centerX, centerY, centerZ }, radius };
	GeometrySlot* slot = takeGeometrySlot( index );
	if ( slot != NULL )
	{
		slot->type = b3_sphereShape;
		slot->sphere = sphere;
		return;
	}
	b3BodyId bodyId = loadBodyId( index, tag );
	recordShape( bodyId, b3CreateSphereShape( bodyId, &shapeDef, &sphere ) );
}

EMSCRIPTEN_KEEPALIVE void addBox( int32_t index, int32_t tag, float centerX, float centerY, float centerZ,
								  float rotationX, float rotationY, float rotationZ, float rotationW, float halfWidth,
								  float halfHeight, float halfDepth )
{
	b3BoxHull box = b3MakeTransformedBoxHull(
		halfWidth, halfHeight, halfDepth,
		loadTransform( centerX, centerY, centerZ, rotationX, rotationY, rotationZ, rotationW ) );
	GeometrySlot* slot = takeGeometrySlot( index );
	if ( slot != NULL )
	{
		slot->type = b3_hullShape;
		slot->box = box;
		slot->hull = &slot->box.base;
		return;
	}
	b3BodyId bodyId = loadBodyId( index, tag );
	recordShape( bodyId, b3CreateHullShape( bodyId, &shapeDef, &box.base ) );
}

EMSCRIPTEN_KEEPALIVE void addCapsule( int32_t index, int32_t tag, float center1X, float center1Y, float center1Z,
									  float center2X, float center2Y, float center2Z, float radius )
{
	b3Capsule capsule = { { center1X, center1Y, center1Z }, { center2X, center2Y, center2Z }, radius };
	GeometrySlot* slot = takeGeometrySlot( index );
	if ( slot != NULL )
	{
		slot->type = b3_capsuleShape;
		slot->capsule = capsule;
		return;
	}
	b3BodyId bodyId = loadBodyId( index, tag );
	recordShape( bodyId, b3CreateCapsuleShape( bodyId, &shapeDef, &capsule ) );
}

// Reads `pointCount` points (x, y, z each) from the input buffer. Returns false when they don't
// form a 3D hull, such as when they all lie on one plane.
EMSCRIPTEN_KEEPALIVE bool addHull( int32_t index, int32_t tag, int pointCount )
{
	b3HullData* hull = b3CreateHull( input, pointCount, 255 );
	if ( hull == NULL )
	{
		return false;
	}
	GeometrySlot* slot = takeGeometrySlot( index );
	if ( slot != NULL )
	{
		slot->type = b3_hullShape;
		slot->hull = hull;
		slot->ownedHull = hull;
		return true;
	}
	b3BodyId bodyId = loadBodyId( index, tag );
	recordShape( bodyId, b3CreateHullShape( bodyId, &shapeDef, hull ) );
	b3DestroyHull( hull );
	return true;
}

// Builds a mesh from `vertexCount` vertices (x, y, z each) then `triangleCount` triangles (three
// vertex indices each) at `values`, followed by one material index per triangle when
// `hasMaterialIndices` is set. Sets `next` to the first value after them.
static b3MeshData* createMesh( float* values, int vertexCount, int triangleCount, bool hasMaterialIndices,
							   float weldTolerance, bool useMedianSplit, float** next )
{
	int32_t* indices = (int32_t*)( values + 3 * vertexCount );
	int32_t* materialIndices = indices + 3 * triangleCount;
	uint8_t* smallMaterialIndices = NULL;
	if ( hasMaterialIndices )
	{
		smallMaterialIndices = malloc( triangleCount );
		for ( int triangleIndex = 0; triangleIndex < triangleCount; ++triangleIndex )
		{
			smallMaterialIndices[triangleIndex] = (uint8_t)materialIndices[triangleIndex];
		}
	}
	b3MeshDef def = { 0 };
	def.vertices = (b3Vec3*)values;
	def.vertexCount = vertexCount;
	def.indices = indices;
	def.triangleCount = triangleCount;
	def.materialIndices = smallMaterialIndices;
	def.weldVertices = !isnan( weldTolerance );
	def.weldTolerance = isnan( weldTolerance ) ? 0.0f : weldTolerance;
	def.useMedianSplit = useMedianSplit;
	def.identifyEdges = true;
	b3MeshData* mesh = b3CreateMesh( &def, NULL, 0 );
	free( smallMaterialIndices );
	*next = (float*)( materialIndices + ( hasMaterialIndices ? triangleCount : 0 ) );
	return mesh;
}

// Reads `materialCount` surface materials (7 values each, as `loadSurfaceMaterial` reads them) at
// `values`, filling in NaN values from the shape definition. Returns NULL for no materials.
static b3SurfaceMaterial* loadSurfaceMaterials( float* values, int materialCount )
{
	if ( !materialCount )
	{
		return NULL;
	}
	b3SurfaceMaterial* materials = malloc( materialCount * sizeof( b3SurfaceMaterial ) );
	for ( int materialIndex = 0; materialIndex < materialCount; ++materialIndex )
	{
		materials[materialIndex] = loadSurfaceMaterial( values + 7 * materialIndex, shapeDef.baseMaterial );
	}
	return materials;
}

// Reads `vertexCount` vertices (x, y, z each), `triangleCount` triangles (three vertex indices each),
// `materialCount` surface materials (7 values each), and then one material index per triangle when
// `materialCount` isn't 0, from the input buffer. A NaN `weldTolerance` doesn't weld vertices.
// Returns false when the mesh has no usable triangles.
EMSCRIPTEN_KEEPALIVE bool addMesh( int32_t index, int32_t tag, int vertexCount, int triangleCount, int materialCount,
								   float weldTolerance, bool useMedianSplit )
{
	float* materialValues = (float*)input + 3 * vertexCount + 3 * triangleCount;
	b3SurfaceMaterial* materials = loadSurfaceMaterials( materialValues, materialCount );
	if ( materialCount )
	{
		// the material indices come after the materials, so they're moved to where `createMesh` reads them
		memmove( materialValues, materialValues + 7 * materialCount, triangleCount * sizeof( int32_t ) );
	}
	float* next;
	b3MeshData* mesh =
		createMesh( input, vertexCount, triangleCount, materialCount != 0, weldTolerance, useMedianSplit, &next );
	if ( mesh == NULL )
	{
		free( materials );
		return false;
	}
	GeometrySlot* slot = takeGeometrySlot( index );
	if ( slot != NULL )
	{
		free( materials );
		slot->type = b3_meshShape;
		slot->mesh = mesh;
		return true;
	}
	shapeDef.materials = materials;
	shapeDef.materialCount = materialCount;
	b3BodyId bodyId = loadBodyId( index, tag );
	recordShape( bodyId, b3CreateMeshShape( bodyId, &shapeDef, mesh, b3Vec3_one ) );
	shapeDef.materials = NULL;
	shapeDef.materialCount = 0;
	free( materials );
	ownGeometry( bodyId, mesh, NULL, NULL );
	return true;
}

// Reads `countX * countZ` heights (x varying fastest), `materialCount` surface materials (7 values
// each), and then one material index per cell when `materialCount` isn't 0 or `hasHoles` is set
// (x varying fastest, with 255 for a hole), from the input buffer. A NaN height limit uses the
// lowest or highest height.
EMSCRIPTEN_KEEPALIVE void addHeightField( int32_t index, int32_t tag, int countX, int countZ, float scaleX,
										  float scaleY, float scaleZ, int materialCount, bool hasHoles,
										  float minimumHeight, float maximumHeight, bool isClockwise )
{
	float* heights = input;
	int heightCount = countX * countZ;
	float minimum = heights[0];
	float maximum = heights[0];
	for ( int heightIndex = 1; heightIndex < heightCount; ++heightIndex )
	{
		minimum = fminf( minimum, heights[heightIndex] );
		maximum = fmaxf( maximum, heights[heightIndex] );
	}
	b3SurfaceMaterial* materials = loadSurfaceMaterials( heights + heightCount, materialCount );
	int cellCount = ( countX - 1 ) * ( countZ - 1 );
	uint8_t* materialIndices = NULL;
	if ( materialCount || hasHoles )
	{
		int32_t* cellValues = (int32_t*)( heights + heightCount + 7 * materialCount );
		materialIndices = malloc( cellCount );
		for ( int cellIndex = 0; cellIndex < cellCount; ++cellIndex )
		{
			materialIndices[cellIndex] = (uint8_t)cellValues[cellIndex];
		}
	}
	b3HeightFieldDef def = { 0 };
	def.heights = heights;
	def.materialIndices = materialIndices;
	def.scale = ( b3Vec3 ){ scaleX, scaleY, scaleZ };
	def.countX = countX;
	def.countZ = countZ;
	def.globalMinimumHeight = isnan( minimumHeight ) ? minimum : minimumHeight;
	def.globalMaximumHeight = isnan( maximumHeight ) ? maximum : maximumHeight;
	def.clockwiseWinding = isClockwise;
	b3HeightFieldData* heightField = b3CreateHeightField( &def );
	free( materialIndices );
	GeometrySlot* slot = takeGeometrySlot( index );
	if ( slot != NULL )
	{
		free( materials );
		slot->type = b3_heightShape;
		slot->heightField = heightField;
		return;
	}
	shapeDef.materials = materials;
	shapeDef.materialCount = materialCount;
	b3BodyId bodyId = loadBodyId( index, tag );
	recordShape( bodyId, b3CreateHeightFieldShape( bodyId, &shapeDef, heightField ) );
	shapeDef.materials = NULL;
	shapeDef.materialCount = 0;
	free( materials );
	ownGeometry( bodyId, NULL, heightField, NULL );
}

// The kinds of compound child, as `addCompound` reads them.
enum CompoundChildKind
{
	compoundSphere,
	compoundCapsule,
	compoundBox,
	compoundHull,
	compoundMesh,
};

// Reads `childCount` children from the input buffer. Each starts with its kind (from
// `CompoundChildKind`) and, except for meshes, its surface material (7 values). Then a sphere has its
// center x, y, z and radius, a capsule its two centers and radius, a box its center x, y, z, rotation
// x, y, z, w, and half width, height, and depth, and a hull its point count and points. A mesh has
// its vertex count, triangle count, material count, NaN or a weld tolerance, and whether to use the
// median split, then its materials (at least one), vertices, triangles, and (with more than one
// material) material indices. Mesh triangles and material indices are integers, and every other
// value is a float. Returns false when a hull or mesh is invalid.
EMSCRIPTEN_KEEPALIVE bool addCompound( int32_t index, int32_t tag, int childCount )
{
	b3CompoundDef def = { 0 };
	def.spheres = malloc( childCount * sizeof( b3CompoundSphereDef ) );
	def.capsules = malloc( childCount * sizeof( b3CompoundCapsuleDef ) );
	def.hulls = malloc( childCount * sizeof( b3CompoundHullDef ) );
	def.meshes = malloc( childCount * sizeof( b3CompoundMeshDef ) );
	b3HullData** hulls = malloc( childCount * sizeof( b3HullData* ) );
	b3MeshData** meshes = malloc( childCount * sizeof( b3MeshData* ) );
	b3SurfaceMaterial** meshMaterials = malloc( childCount * sizeof( b3SurfaceMaterial* ) );
	b3BoxHull* boxes = malloc( childCount * sizeof( b3BoxHull ) );
	int ownedHullCount = 0;
	bool isValid = true;
	float* next = input;
	for ( int childIndex = 0; childIndex < childCount && isValid; ++childIndex )
	{
		enum CompoundChildKind kind = (enum CompoundChildKind)next[0];
		if ( kind == compoundMesh )
		{
			int vertexCount = (int)next[1];
			int triangleCount = (int)next[2];
			int materialCount = (int)next[3];
			float weldTolerance = next[4];
			bool useMedianSplit = next[5] != 0.0f;
			b3SurfaceMaterial* materials = loadSurfaceMaterials( next + 6, materialCount );
			b3MeshData* mesh = createMesh( next + 6 + 7 * materialCount, vertexCount, triangleCount, materialCount > 1,
										   weldTolerance, useMedianSplit, &next );
			if ( mesh == NULL )
			{
				free( materials );
				isValid = false;
				break;
			}
			meshes[def.meshCount] = mesh;
			meshMaterials[def.meshCount] = materials;
			def.meshes[def.meshCount++] = ( b3CompoundMeshDef ){ mesh, b3Transform_identity, b3Vec3_one, materials,
																  materialCount };
			continue;
		}
		b3SurfaceMaterial material = loadSurfaceMaterial( next + 1, shapeDef.baseMaterial );
		float* values = next + 8;
		if ( kind == compoundSphere )
		{
			def.spheres[def.sphereCount++] = ( b3CompoundSphereDef ){ { { values[0], values[1], values[2] }, values[3] },
																	   material };
			next = values + 4;
		}
		else if ( kind == compoundCapsule )
		{
			def.capsules[def.capsuleCount++] = ( b3CompoundCapsuleDef ){
				{ { values[0], values[1], values[2] }, { values[3], values[4], values[5] }, values[6] }, material };
			next = values + 7;
		}
		else if ( kind == compoundBox )
		{
			boxes[childIndex] = b3MakeTransformedBoxHull(
				values[7], values[8], values[9],
				loadTransform( values[0], values[1], values[2], values[3], values[4], values[5], values[6] ) );
			def.hulls[def.hullCount++] = ( b3CompoundHullDef ){ &boxes[childIndex].base, b3Transform_identity, material };
			next = values + 10;
		}
		else
		{
			int pointCount = (int)values[0];
			b3HullData* hull = b3CreateHull( (b3Vec3*)( values + 1 ), pointCount, 255 );
			next = values + 1 + 3 * pointCount;
			if ( hull == NULL )
			{
				isValid = false;
				break;
			}
			hulls[ownedHullCount++] = hull;
			def.hulls[def.hullCount++] = ( b3CompoundHullDef ){ hull, b3Transform_identity, material };
		}
	}
	b3CompoundData* compound = isValid ? b3CreateCompound( &def ) : NULL;
	// the compound copies its children, so only the compound itself has to outlive this call
	for ( int hullIndex = 0; hullIndex < ownedHullCount; ++hullIndex )
	{
		b3DestroyHull( hulls[hullIndex] );
	}
	for ( int meshIndex = 0; meshIndex < def.meshCount; ++meshIndex )
	{
		b3DestroyMesh( meshes[meshIndex] );
		free( meshMaterials[meshIndex] );
	}
	free( def.spheres );
	free( def.capsules );
	free( def.hulls );
	free( def.meshes );
	free( hulls );
	free( meshes );
	free( meshMaterials );
	free( boxes );
	if ( compound == NULL )
	{
		return false;
	}
	GeometrySlot* slot = takeGeometrySlot( index );
	if ( slot != NULL )
	{
		slot->type = b3_compoundShape;
		slot->compound = compound;
		return true;
	}
	b3BodyId bodyId = loadBodyId( index, tag );
	recordShape( bodyId, b3CreateCompoundShape( bodyId, &shapeDef, compound ) );
	ownGeometry( bodyId, NULL, NULL, compound );
	return true;
}

// Destroys every shape on the body, frees their geometry, and recomputes the body's mass.
EMSCRIPTEN_KEEPALIVE void removeShapes( int32_t index, int32_t tag )
{
	b3BodyId bodyId = loadBodyId( index, tag );
	int shapeCount = b3Body_GetShapeCount( bodyId );
	b3ShapeId* shapeIds = malloc( shapeCount * sizeof( b3ShapeId ) );
	b3Body_GetShapes( bodyId, shapeIds, shapeCount );
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		b3DestroyShape( shapeIds[shapeIndex], false );
	}
	free( shapeIds );
	freeGeometry( isOwnedByBody, b3StoreBodyId( bodyId ) );
	b3Body_ApplyMassFromShapes( bodyId );
}

EMSCRIPTEN_KEEPALIVE void setSleepEnabled( int32_t index, int32_t tag, bool isEnabled )
{
	b3Body_EnableSleep( loadBodyId( index, tag ), isEnabled );
}

// Writes position x, y, z, rotation x, y, z, w, velocity x, y, z, and angular velocity x, y, z.
EMSCRIPTEN_KEEPALIVE float* readBody( int32_t index, int32_t tag )
{
	b3BodyId bodyId = loadBodyId( index, tag );
	b3WorldTransform transform = b3Body_GetTransform( bodyId );
	b3Vec3 velocity = b3Body_GetLinearVelocity( bodyId );
	b3Vec3 angularVelocity = b3Body_GetAngularVelocity( bodyId );
	float* written = reserveOutput( 13 * sizeof( float ) );
	written[0] = transform.p.x;
	written[1] = transform.p.y;
	written[2] = transform.p.z;
	written[3] = transform.q.v.x;
	written[4] = transform.q.v.y;
	written[5] = transform.q.v.z;
	written[6] = transform.q.s;
	written[7] = velocity.x;
	written[8] = velocity.y;
	written[9] = velocity.z;
	written[10] = angularVelocity.x;
	written[11] = angularVelocity.y;
	written[12] = angularVelocity.z;
	return written;
}

EMSCRIPTEN_KEEPALIVE void setTransform( int32_t index, int32_t tag, float x, float y, float z, float rotationX,
										float rotationY, float rotationZ, float rotationW )
{
	b3Body_SetTransform( loadBodyId( index, tag ), ( b3Pos ){ x, y, z },
						 ( b3Quat ){ { rotationX, rotationY, rotationZ }, rotationW } );
}

EMSCRIPTEN_KEEPALIVE void setVelocity( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Body_SetLinearVelocity( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z } );
}

EMSCRIPTEN_KEEPALIVE void setAngularVelocity( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Body_SetAngularVelocity( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z } );
}

EMSCRIPTEN_KEEPALIVE void applyForce( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Body_ApplyForceToCenter( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z }, true );
}

EMSCRIPTEN_KEEPALIVE void applyImpulse( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Body_ApplyLinearImpulseToCenter( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z }, true );
}

EMSCRIPTEN_KEEPALIVE float getMass( int32_t index, int32_t tag )
{
	return b3Body_GetMass( loadBodyId( index, tag ) );
}

// Writes the manifold count, then for each manifold with points: normal x, y, z, separation, and the
// other body's type. The normal points toward this body.
EMSCRIPTEN_KEEPALIVE float* readContacts( int32_t index, int32_t tag )
{
	b3BodyId bodyId = loadBodyId( index, tag );
	int capacity = b3Body_GetContactCapacity( bodyId );
	b3ContactData* contacts = malloc( ( capacity ? capacity : 1 ) * sizeof( b3ContactData ) );
	int contactCount = b3Body_GetContactData( bodyId, contacts, capacity );
	int manifoldTotal = 0;
	for ( int contactIndex = 0; contactIndex < contactCount; ++contactIndex )
	{
		manifoldTotal += contacts[contactIndex].manifoldCount;
	}
	float* written = reserveOutput( ( 1 + 5 * manifoldTotal ) * sizeof( float ) );
	int writtenCount = 0;
	for ( int contactIndex = 0; contactIndex < contactCount; ++contactIndex )
	{
		b3ContactData* contact = contacts + contactIndex;
		bool isShapeA = b3Shape_GetBody( contact->shapeIdA ).index1 == bodyId.index1;
		// Box3D's normal points from shape A to shape B
		float direction = isShapeA ? -1.0f : 1.0f;
		float otherType =
			(float)b3Body_GetType( b3Shape_GetBody( isShapeA ? contact->shapeIdB : contact->shapeIdA ) );
		for ( int manifoldIndex = 0; manifoldIndex < contact->manifoldCount; ++manifoldIndex )
		{
			const b3Manifold* manifold = contact->manifolds + manifoldIndex;
			if ( manifold->pointCount == 0 )
			{
				continue;
			}
			float separation = manifold->points[0].separation;
			for ( int pointIndex = 1; pointIndex < manifold->pointCount; ++pointIndex )
			{
				separation = fminf( separation, manifold->points[pointIndex].separation );
			}
			float* slot = written + 1 + 5 * writtenCount++;
			slot[0] = manifold->normal.x * direction;
			slot[1] = manifold->normal.y * direction;
			slot[2] = manifold->normal.z * direction;
			slot[3] = separation;
			slot[4] = otherType;
		}
	}
	free( contacts );
	written[0] = (float)writtenCount;
	return written;
}

EMSCRIPTEN_KEEPALIVE void applyForceAtPoint( int32_t index, int32_t tag, float x, float y, float z, float pointX,
											 float pointY, float pointZ )
{
	b3Body_ApplyForce( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z }, ( b3Pos ){ pointX, pointY, pointZ }, true );
}

EMSCRIPTEN_KEEPALIVE void applyImpulseAtPoint( int32_t index, int32_t tag, float x, float y, float z, float pointX,
											   float pointY, float pointZ )
{
	b3Body_ApplyLinearImpulse( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z }, ( b3Pos ){ pointX, pointY, pointZ },
							   true );
}

EMSCRIPTEN_KEEPALIVE void applyTorque( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Body_ApplyTorque( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z }, true );
}

EMSCRIPTEN_KEEPALIVE void applyAngularImpulse( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Body_ApplyAngularImpulse( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z }, true );
}

static float* writeVector( float x, float y, float z )
{
	float* written = reserveOutput( 3 * sizeof( float ) );
	written[0] = x;
	written[1] = y;
	written[2] = z;
	return written;
}

EMSCRIPTEN_KEEPALIVE float* getWorldPoint( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Pos point = b3Body_GetWorldPoint( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z } );
	return writeVector( point.x, point.y, point.z );
}

EMSCRIPTEN_KEEPALIVE float* getLocalPoint( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Vec3 point = b3Body_GetLocalPoint( loadBodyId( index, tag ), ( b3Pos ){ x, y, z } );
	return writeVector( point.x, point.y, point.z );
}

EMSCRIPTEN_KEEPALIVE float* getWorldVector( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Vec3 vector = b3Body_GetWorldVector( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z } );
	return writeVector( vector.x, vector.y, vector.z );
}

EMSCRIPTEN_KEEPALIVE float* getLocalVector( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Vec3 vector = b3Body_GetLocalVector( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z } );
	return writeVector( vector.x, vector.y, vector.z );
}

EMSCRIPTEN_KEEPALIVE float* getPointVelocity( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Vec3 velocity = b3Body_GetWorldPointVelocity( loadBodyId( index, tag ), ( b3Pos ){ x, y, z } );
	return writeVector( velocity.x, velocity.y, velocity.z );
}

static b3QueryFilter makeQueryFilter( uint64_t category, uint64_t mask )
{
	b3QueryFilter filter = b3DefaultQueryFilter();
	filter.categoryBits = category;
	filter.maskBits = mask;
	return filter;
}

// Writes a hit flag and the hit shape's entity id as two int32s, then the hit point x, y, z, the
// surface normal x, y, z, and the fraction of the translation traveled as floats.
static int32_t* writeHit( bool hit, b3ShapeId shapeId, b3Pos point, b3Vec3 normal, float fraction )
{
	int32_t* written = reserveOutput( 2 * sizeof( int32_t ) + 7 * sizeof( float ) );
	written[0] = hit;
	written[1] = hit ? (int32_t)(intptr_t)b3Shape_GetUserData( shapeId ) : 0;
	float* numbers = (float*)( written + 2 );
	numbers[0] = point.x;
	numbers[1] = point.y;
	numbers[2] = point.z;
	numbers[3] = normal.x;
	numbers[4] = normal.y;
	numbers[5] = normal.z;
	numbers[6] = fraction;
	return written;
}

EMSCRIPTEN_KEEPALIVE int32_t* castRay( uint32_t world, float x, float y, float z, float translationX,
									   float translationY, float translationZ, uint64_t category, uint64_t mask )
{
	b3RayResult result = b3World_CastRayClosest( b3LoadWorldId( world ), ( b3Pos ){ x, y, z },
												 ( b3Vec3 ){ translationX, translationY, translationZ },
												 makeQueryFilter( category, mask ) );
	return writeHit( result.hit, result.shapeId, result.point, result.normal, result.fraction );
}

typedef struct ClosestHit
{
	bool hit;
	b3ShapeId shapeId;
	b3Pos point;
	b3Vec3 normal;
	float fraction;
} ClosestHit;

static float recordClosestHit( b3ShapeId shapeId, b3Pos point, b3Vec3 normal, float fraction, uint64_t userMaterialId,
							   int triangleIndex, int childIndex, void* context )
{
	( (void)userMaterialId, (void)triangleIndex, (void)childIndex );
	ClosestHit* closest = context;
	if ( !closest->hit || fraction < closest->fraction )
	{
		*closest = ( ClosestHit ){ true, shapeId, point, normal, fraction };
	}
	// returning the fraction makes Box3D skip anything farther away
	return fraction;
}

// Reads `pointCount` points (x, y, z each, relative to the shape's position and before its rotation)
// from the input buffer. The cast shape is the hull of those points, grown by `radius`.
EMSCRIPTEN_KEEPALIVE int32_t* castShape( uint32_t world, int pointCount, float radius, float x, float y, float z,
										 float rotationX, float rotationY, float rotationZ, float rotationW,
										 float translationX, float translationY, float translationZ, uint64_t category,
										 uint64_t mask )
{
	b3Quat rotation = { { rotationX, rotationY, rotationZ }, rotationW };
	b3Vec3* points = input;
	for ( int pointIndex = 0; pointIndex < pointCount; ++pointIndex )
	{
		points[pointIndex] = b3RotateVector( rotation, points[pointIndex] );
	}
	b3ShapeProxy proxy = { points, pointCount, radius };
	ClosestHit closest = { 0 };
	b3World_CastShape( b3LoadWorldId( world ), ( b3Pos ){ x, y, z }, &proxy,
					   ( b3Vec3 ){ translationX, translationY, translationZ }, makeQueryFilter( category, mask ),
					   recordClosestHit, &closest );
	return writeHit( closest.hit, closest.shapeId, closest.point, closest.normal, closest.fraction );
}

// Writes the body type, then the enabled, bullet, and awake flags, then the motion lock bits, as int32s,
// then the gravity scale, linear damping, angular damping, and sleep threshold as floats.
EMSCRIPTEN_KEEPALIVE int32_t* readSettings( int32_t index, int32_t tag )
{
	b3BodyId bodyId = loadBodyId( index, tag );
	b3MotionLocks locks = b3Body_GetMotionLocks( bodyId );
	int32_t* written = reserveOutput( 9 * sizeof( int32_t ) );
	written[0] = b3Body_GetType( bodyId );
	written[1] = b3Body_IsEnabled( bodyId );
	written[2] = b3Body_IsBullet( bodyId );
	written[3] = b3Body_IsAwake( bodyId );
	written[4] = locks.linearX | locks.linearY << 1 | locks.linearZ << 2 | locks.angularX << 3 | locks.angularY << 4 |
				 locks.angularZ << 5;
	( (float*)written )[5] = b3Body_GetGravityScale( bodyId );
	( (float*)written )[6] = b3Body_GetLinearDamping( bodyId );
	( (float*)written )[7] = b3Body_GetAngularDamping( bodyId );
	( (float*)written )[8] = b3Body_GetSleepThreshold( bodyId );
	return written;
}

EMSCRIPTEN_KEEPALIVE void setBodyType( int32_t index, int32_t tag, int type )
{
	b3Body_SetType( loadBodyId( index, tag ), (b3BodyType)type );
}

EMSCRIPTEN_KEEPALIVE void setEnabled( int32_t index, int32_t tag, bool isEnabled )
{
	b3BodyId bodyId = loadBodyId( index, tag );
	if ( isEnabled )
	{
		b3Body_Enable( bodyId );
	}
	else
	{
		b3Body_Disable( bodyId );
	}
}

EMSCRIPTEN_KEEPALIVE void setBullet( int32_t index, int32_t tag, bool isBullet )
{
	b3Body_SetBullet( loadBodyId( index, tag ), isBullet );
}

EMSCRIPTEN_KEEPALIVE void setAwake( int32_t index, int32_t tag, bool isAwake )
{
	b3Body_SetAwake( loadBodyId( index, tag ), isAwake );
}

EMSCRIPTEN_KEEPALIVE void setGravityScale( int32_t index, int32_t tag, float gravityScale )
{
	b3Body_SetGravityScale( loadBodyId( index, tag ), gravityScale );
}

EMSCRIPTEN_KEEPALIVE void setMotionLocks( int32_t index, int32_t tag, int motionLocks )
{
	b3Body_SetMotionLocks( loadBodyId( index, tag ), loadMotionLocks( motionLocks ) );
}

EMSCRIPTEN_KEEPALIVE void setDamping( int32_t index, int32_t tag, float linearDamping, float angularDamping )
{
	b3BodyId bodyId = loadBodyId( index, tag );
	b3Body_SetLinearDamping( bodyId, linearDamping );
	b3Body_SetAngularDamping( bodyId, angularDamping );
}

EMSCRIPTEN_KEEPALIVE void setSleepThreshold( int32_t index, int32_t tag, float sleepThreshold )
{
	b3Body_SetSleepThreshold( loadBodyId( index, tag ), sleepThreshold );
}

EMSCRIPTEN_KEEPALIVE void setHitEvents( int32_t index, int32_t tag, bool isEnabled )
{
	b3Body_EnableHitEvents( loadBodyId( index, tag ), isEnabled );
}

// Reads the mass, the center of mass x, y, z in body space, and the 3x3 inertia tensor about it,
// column by column, from the input buffer. NaN mass goes back to the mass from the body's shapes.
EMSCRIPTEN_KEEPALIVE void setMassData( int32_t index, int32_t tag )
{
	b3BodyId bodyId = loadBodyId( index, tag );
	const float* values = input;
	if ( isnan( values[0] ) )
	{
		b3Body_ApplyMassFromShapes( bodyId );
		return;
	}
	b3MassData massData = {
		values[0],
		{ values[1], values[2], values[3] },
		{ { values[4], values[5], values[6] }, { values[7], values[8], values[9] }, { values[10], values[11], values[12] } },
	};
	b3Body_SetMassData( bodyId, massData );
}

static float* writeMassData( b3MassData massData );

// Writes the same 13 floats that `setMassData` reads.
EMSCRIPTEN_KEEPALIVE float* readMassData( int32_t index, int32_t tag )
{
	return writeMassData( b3Body_GetMassData( loadBodyId( index, tag ) ) );
}

static float* writeMassData( b3MassData massData )
{
	float* written = reserveOutput( 13 * sizeof( float ) );
	written[0] = massData.mass;
	written[1] = massData.center.x;
	written[2] = massData.center.y;
	written[3] = massData.center.z;
	const b3Vec3* columns[3] = { &massData.inertia.cx, &massData.inertia.cy, &massData.inertia.cz };
	for ( int column = 0; column < 3; ++column )
	{
		written[4 + 3 * column] = columns[column]->x;
		written[5 + 3 * column] = columns[column]->y;
		written[6 + 3 * column] = columns[column]->z;
	}
	return written;
}

EMSCRIPTEN_KEEPALIVE float* getLocalPointVelocity( int32_t index, int32_t tag, float x, float y, float z )
{
	b3Vec3 velocity = b3Body_GetLocalPointVelocity( loadBodyId( index, tag ), ( b3Vec3 ){ x, y, z } );
	return writeVector( velocity.x, velocity.y, velocity.z );
}

// Writes the lower x, y, z and upper x, y, z corners of the box around every shape. A body without
// shapes gets a box around its position.
EMSCRIPTEN_KEEPALIVE float* computeBounds( int32_t index, int32_t tag )
{
	b3AABB box = b3Body_ComputeAABB( loadBodyId( index, tag ) );
	float* written = reserveOutput( 6 * sizeof( float ) );
	written[0] = box.lowerBound.x;
	written[1] = box.lowerBound.y;
	written[2] = box.lowerBound.z;
	written[3] = box.upperBound.x;
	written[4] = box.upperBound.y;
	written[5] = box.upperBound.z;
	return written;
}

// The caller frees the returned ids.
static b3ShapeId* readBodyShapes( b3BodyId bodyId, int* shapeCount )
{
	*shapeCount = b3Body_GetShapeCount( bodyId );
	b3ShapeId* shapeIds = malloc( ( *shapeCount ? *shapeCount : 1 ) * sizeof( b3ShapeId ) );
	b3Body_GetShapes( bodyId, shapeIds, *shapeCount );
	return shapeIds;
}

// Box3D only blows on spheres, capsules, and hulls.
EMSCRIPTEN_KEEPALIVE void applyWind( int32_t index, int32_t tag, float windX, float windY, float windZ, float drag,
									 float lift, float maxSpeed )
{
	int shapeCount;
	b3ShapeId* shapeIds = readBodyShapes( loadBodyId( index, tag ), &shapeCount );
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		b3Shape_ApplyWind( shapeIds[shapeIndex], ( b3Vec3 ){ windX, windY, windZ }, drag, lift, maxSpeed, true );
	}
	free( shapeIds );
}

// Same output as `castRay`, but only hits this body's shapes, ignoring filters.
EMSCRIPTEN_KEEPALIVE int32_t* castBodyRay( int32_t index, int32_t tag, float x, float y, float z, float translationX,
										   float translationY, float translationZ )
{
	int shapeCount;
	b3ShapeId* shapeIds = readBodyShapes( loadBodyId( index, tag ), &shapeCount );
	ClosestHit closest = { 0 };
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		b3WorldCastOutput result = b3Shape_RayCast( shapeIds[shapeIndex], ( b3Pos ){ x, y, z },
													( b3Vec3 ){ translationX, translationY, translationZ } );
		if ( result.hit )
		{
			recordClosestHit( shapeIds[shapeIndex], result.point, result.normal, result.fraction, 0, 0, 0, &closest );
		}
	}
	free( shapeIds );
	return writeHit( closest.hit, closest.shapeId, closest.point, closest.normal, closest.fraction );
}

// Writes whether the body has a sphere, capsule, or hull, then the x, y, z of the point on those
// closest to the target. A target inside one of them is its own closest point.
EMSCRIPTEN_KEEPALIVE float* getClosestPoint( int32_t index, int32_t tag, float x, float y, float z )
{
	int shapeCount;
	b3ShapeId* shapeIds = readBodyShapes( loadBodyId( index, tag ), &shapeCount );
	b3Vec3 target = { x, y, z };
	b3Vec3 closest = target;
	float closestDistance = INFINITY;
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		b3ShapeType type = b3Shape_GetType( shapeIds[shapeIndex] );
		// Box3D's closest point query asserts on every other shape type
		if ( type != b3_sphereShape && type != b3_capsuleShape && type != b3_hullShape )
		{
			continue;
		}
		b3Vec3 point = b3Shape_GetClosestPoint( shapeIds[shapeIndex], target );
		float distance = b3Distance( point, target );
		if ( distance < closestDistance )
		{
			closest = point;
			closestDistance = distance;
		}
	}
	free( shapeIds );
	float* written = reserveOutput( 4 * sizeof( float ) );
	written[0] = (float)( closestDistance < INFINITY );
	written[1] = closest.x;
	written[2] = closest.y;
	written[3] = closest.z;
	return written;
}

typedef struct OverlapList
{
	int32_t* entityIds;
	int count;
	int capacity;
} OverlapList;

static bool recordOverlap( b3ShapeId shapeId, void* context )
{
	OverlapList* list = context;
	if ( list->count == list->capacity )
	{
		list->capacity = list->capacity ? list->capacity * 2 : 16;
		list->entityIds = realloc( list->entityIds, list->capacity * sizeof( int32_t ) );
	}
	list->entityIds[list->count++] = shapeEntity( shapeId );
	return true;
}

// Writes the count, then each overlapping shape's entity id. An entity with several overlapping
// shapes appears once per shape.
static int32_t* writeOverlaps( OverlapList* list )
{
	int32_t* written = reserveOutput( ( 1 + list->count ) * sizeof( int32_t ) );
	written[0] = list->count;
	for ( int index = 0; index < list->count; ++index )
	{
		written[1 + index] = list->entityIds[index];
	}
	free( list->entityIds );
	return written;
}

// Writes the entity ids inside this body's sensor shapes as of the last step, the same way as
// `overlapAabb`.
EMSCRIPTEN_KEEPALIVE int32_t* readSensorOverlaps( int32_t index, int32_t tag )
{
	int shapeCount;
	b3ShapeId* shapeIds = readBodyShapes( loadBodyId( index, tag ), &shapeCount );
	OverlapList list = { 0 };
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		int capacity = b3Shape_GetSensorCapacity( shapeIds[shapeIndex] );
		b3ShapeId* visitorIds = malloc( ( capacity ? capacity : 1 ) * sizeof( b3ShapeId ) );
		int visitorCount = b3Shape_GetSensorData( shapeIds[shapeIndex], visitorIds, capacity );
		for ( int visitorIndex = 0; visitorIndex < visitorCount; ++visitorIndex )
		{
			// the list can still hold shapes destroyed since the last step
			if ( b3Shape_IsValid( visitorIds[visitorIndex] ) )
			{
				recordOverlap( visitorIds[visitorIndex], &list );
			}
		}
		free( visitorIds );
	}
	free( shapeIds );
	return writeOverlaps( &list );
}

EMSCRIPTEN_KEEPALIVE int32_t* overlapAabb( uint32_t world, float lowerX, float lowerY, float lowerZ, float upperX,
										   float upperY, float upperZ, uint64_t category, uint64_t mask )
{
	OverlapList list = { 0 };
	b3AABB box = { { lowerX, lowerY, lowerZ }, { upperX, upperY, upperZ } };
	b3World_OverlapAABB( b3LoadWorldId( world ), box, makeQueryFilter( category, mask ), recordOverlap, &list );
	return writeOverlaps( &list );
}

// Reads the shape the same way as `castShape`.
EMSCRIPTEN_KEEPALIVE int32_t* overlapShape( uint32_t world, int pointCount, float radius, float x, float y, float z,
											float rotationX, float rotationY, float rotationZ, float rotationW,
											uint64_t category, uint64_t mask )
{
	b3Quat rotation = { { rotationX, rotationY, rotationZ }, rotationW };
	b3Vec3* points = input;
	for ( int pointIndex = 0; pointIndex < pointCount; ++pointIndex )
	{
		points[pointIndex] = b3RotateVector( rotation, points[pointIndex] );
	}
	b3ShapeProxy proxy = { points, pointCount, radius };
	OverlapList list = { 0 };
	b3World_OverlapShape( b3LoadWorldId( world ), ( b3Pos ){ x, y, z }, &proxy, makeQueryFilter( category, mask ),
						  recordOverlap, &list );
	return writeOverlaps( &list );
}

// Sets the material of every shape on the body, including every per-triangle material of meshes
// and height fields. NaN leaves that value unchanged, and a NaN tangent velocity x leaves the whole
// tangent velocity unchanged. Compound materials can't change, so JavaScript recreates those shapes.
EMSCRIPTEN_KEEPALIVE void setMaterial( int32_t index, int32_t tag, float density, float friction, float restitution,
									   float rollingResistance, float tangentVelocityX, float tangentVelocityY,
									   float tangentVelocityZ, float userMaterialId )
{
	float materialValues[7] = { friction, restitution, rollingResistance, tangentVelocityX, tangentVelocityY,
								tangentVelocityZ, userMaterialId };
	b3BodyId bodyId = loadBodyId( index, tag );
	int shapeCount = b3Body_GetShapeCount( bodyId );
	b3ShapeId* shapeIds = malloc( shapeCount * sizeof( b3ShapeId ) );
	b3Body_GetShapes( bodyId, shapeIds, shapeCount );
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		b3ShapeId shapeId = shapeIds[shapeIndex];
		if ( !isnan( density ) )
		{
			b3Shape_SetDensity( shapeId, density, false );
		}
		if ( b3Shape_GetType( shapeId ) == b3_compoundShape )
		{
			continue;
		}
		int materialCount = b3Shape_GetMeshMaterialCount( shapeId );
		for ( int materialIndex = 0; materialIndex < materialCount; ++materialIndex )
		{
			b3Shape_SetMeshMaterial(
				shapeId, loadSurfaceMaterial( materialValues, b3Shape_GetMeshSurfaceMaterial( shapeId, materialIndex ) ),
				materialIndex );
		}
	}
	free( shapeIds );
	if ( !isnan( density ) )
	{
		b3Body_ApplyMassFromShapes( bodyId );
	}
}

EMSCRIPTEN_KEEPALIVE void setTargetTransform( int32_t index, int32_t tag, float x, float y, float z, float rotationX,
											  float rotationY, float rotationZ, float rotationW, float seconds )
{
	b3Body_SetTargetTransform( loadBodyId( index, tag ),
							   ( b3WorldTransform ){ { x, y, z }, { { rotationX, rotationY, rotationZ }, rotationW } },
							   seconds, true );
}

EMSCRIPTEN_KEEPALIVE void explode( uint32_t world, float x, float y, float z, float radius, float falloff,
								   float impulsePerArea, uint64_t mask )
{
	b3ExplosionDef def = b3DefaultExplosionDef();
	def.maskBits = mask;
	def.position = ( b3Pos ){ x, y, z };
	def.radius = radius;
	def.falloff = falloff;
	def.impulsePerArea = impulsePerArea;
	b3World_Explode( b3LoadWorldId( world ), &def );
}

EMSCRIPTEN_KEEPALIVE float castMover( uint32_t world, float x, float y, float z, float center1X, float center1Y,
									  float center1Z, float center2X, float center2Y, float center2Z, float radius,
									  float translationX, float translationY, float translationZ, uint64_t category,
									  uint64_t mask )
{
	b3Capsule mover = { { center1X, center1Y, center1Z }, { center2X, center2Y, center2Z }, radius };
	return b3World_CastMover( b3LoadWorldId( world ), ( b3Pos ){ x, y, z }, &mover,
							  ( b3Vec3 ){ translationX, translationY, translationZ }, makeQueryFilter( category, mask ),
							  NULL, NULL );
}

typedef struct PlaneList
{
	float* values;
	int count;
	int capacity;
} PlaneList;

// Each plane takes 8 floats: the entity id (as an int32), normal x, y, z, offset, and point x, y, z.
static bool recordPlanes( b3ShapeId shapeId, const b3PlaneResult* results, int resultCount, void* context )
{
	PlaneList* list = context;
	for ( int resultIndex = 0; resultIndex < resultCount; ++resultIndex )
	{
		if ( list->count == list->capacity )
		{
			list->capacity = list->capacity ? list->capacity * 2 : 8;
			list->values = realloc( list->values, list->capacity * 8 * sizeof( float ) );
		}
		const b3PlaneResult* result = results + resultIndex;
		float* plane = list->values + list->count * 8;
		( (int32_t*)plane )[0] = shapeEntity( shapeId );
		plane[1] = result->plane.normal.x;
		plane[2] = result->plane.normal.y;
		plane[3] = result->plane.normal.z;
		plane[4] = result->plane.offset;
		plane[5] = result->point.x;
		plane[6] = result->point.y;
		plane[7] = result->point.z;
		++list->count;
	}
	return true;
}

// Writes the plane count as an int32, then each plane as `recordPlanes` lays it out.
EMSCRIPTEN_KEEPALIVE int32_t* collideMover( uint32_t world, float x, float y, float z, float center1X,
											float center1Y, float center1Z, float center2X, float center2Y,
											float center2Z, float radius, uint64_t category, uint64_t mask )
{
	b3Capsule mover = { { center1X, center1Y, center1Z }, { center2X, center2Y, center2Z }, radius };
	PlaneList list = { 0 };
	b3World_CollideMover( b3LoadWorldId( world ), ( b3Pos ){ x, y, z }, &mover, makeQueryFilter( category, mask ),
						  recordPlanes, &list );
	int32_t* written = reserveOutput( ( 1 + list.count * 8 ) * sizeof( int32_t ) );
	written[0] = list.count;
	memcpy( written + 1, list.values, list.count * 8 * sizeof( float ) );
	free( list.values );
	return written;
}

// Reads `planeCount` planes from the input buffer as normal x, y, z, offset, push limit, and clip
// velocity (0 or 1) floats. Writes the solved delta x, y, z, then `velocity` clipped against the
// planes the solve pushed on. `b3ClipVector` skips planes with no push, so it has to see this solve's
// planes.
EMSCRIPTEN_KEEPALIVE float* solveMoverPlanes( int planeCount, float targetX, float targetY, float targetZ,
											  float velocityX, float velocityY, float velocityZ )
{
	float* values = input;
	b3CollisionPlane* planes = malloc( planeCount * sizeof( b3CollisionPlane ) );
	for ( int index = 0; index < planeCount; ++index )
	{
		float* value = values + index * 6;
		planes[index] = ( b3CollisionPlane ){
			{ { value[0], value[1], value[2] }, value[3] }, value[4], 0.0f, value[5] != 0.0f };
	}
	b3PlaneSolverResult result = b3SolvePlanes( ( b3Vec3 ){ targetX, targetY, targetZ }, planes, planeCount );
	b3Vec3 velocity = b3ClipVector( ( b3Vec3 ){ velocityX, velocityY, velocityZ }, planes, planeCount );
	free( planes );
	float* written = reserveOutput( 6 * sizeof( float ) );
	written[0] = result.delta.x;
	written[1] = result.delta.y;
	written[2] = result.delta.z;
	written[3] = velocity.x;
	written[4] = velocity.y;
	written[5] = velocity.z;
	return written;
}

// Joint settings arrive in the input buffer as floats in a fixed order per joint type. NaN keeps
// Box3D's default for that setting, and booleans arrive as 0 or 1.
static float* nextInput;

static void readFloat( float* field )
{
	float value = *nextInput++;
	if ( !isnan( value ) )
	{
		*field = value;
	}
}

static void readBool( bool* field )
{
	float value = *nextInput++;
	if ( !isnan( value ) )
	{
		*field = value != 0.0f;
	}
}

static void readVector( b3Vec3* field )
{
	readFloat( &field->x );
	readFloat( &field->y );
	readFloat( &field->z );
}

// A quaternion is x, y, z, then w.
static void readQuaternion( b3Quat* field )
{
	readVector( &field->v );
	readFloat( &field->s );
}

// Every joint's settings start with frame A (position, then rotation), frame B, force threshold,
// torque threshold, constraint hertz, constraint damping ratio, and collide connected.
static void readBase( b3JointDef* base )
{
	readVector( &base->localFrameA.p );
	readQuaternion( &base->localFrameA.q );
	readVector( &base->localFrameB.p );
	readQuaternion( &base->localFrameB.q );
	readFloat( &base->forceThreshold );
	readFloat( &base->torqueThreshold );
	readFloat( &base->constraintHertz );
	readFloat( &base->constraintDampingRatio );
	readBool( &base->collideConnected );
}

static void readParallel( b3ParallelJointDef* def )
{
	readFloat( &def->hertz );
	readFloat( &def->dampingRatio );
	readFloat( &def->maxTorque );
}

static void readDistance( b3DistanceJointDef* def )
{
	readFloat( &def->length );
	readBool( &def->enableSpring );
	readFloat( &def->lowerSpringForce );
	readFloat( &def->upperSpringForce );
	readFloat( &def->hertz );
	readFloat( &def->dampingRatio );
	readBool( &def->enableLimit );
	readFloat( &def->minLength );
	readFloat( &def->maxLength );
	readBool( &def->enableMotor );
	readFloat( &def->maxMotorForce );
	readFloat( &def->motorSpeed );
}

static void readMotor( b3MotorJointDef* def )
{
	readVector( &def->linearVelocity );
	readFloat( &def->maxVelocityForce );
	readVector( &def->angularVelocity );
	readFloat( &def->maxVelocityTorque );
	readFloat( &def->linearHertz );
	readFloat( &def->linearDampingRatio );
	readFloat( &def->maxSpringForce );
	readFloat( &def->angularHertz );
	readFloat( &def->angularDampingRatio );
	readFloat( &def->maxSpringTorque );
}

static void readPrismatic( b3PrismaticJointDef* def )
{
	readBool( &def->enableSpring );
	readFloat( &def->hertz );
	readFloat( &def->dampingRatio );
	readFloat( &def->targetTranslation );
	readBool( &def->enableLimit );
	readFloat( &def->lowerTranslation );
	readFloat( &def->upperTranslation );
	readBool( &def->enableMotor );
	readFloat( &def->maxMotorForce );
	readFloat( &def->motorSpeed );
}

static void readRevolute( b3RevoluteJointDef* def )
{
	readFloat( &def->targetAngle );
	readBool( &def->enableSpring );
	readFloat( &def->hertz );
	readFloat( &def->dampingRatio );
	readBool( &def->enableLimit );
	readFloat( &def->lowerAngle );
	readFloat( &def->upperAngle );
	readBool( &def->enableMotor );
	readFloat( &def->maxMotorTorque );
	readFloat( &def->motorSpeed );
}

static void readSpherical( b3SphericalJointDef* def )
{
	readBool( &def->enableSpring );
	readFloat( &def->hertz );
	readFloat( &def->dampingRatio );
	readQuaternion( &def->targetRotation );
	readBool( &def->enableConeLimit );
	readFloat( &def->coneAngle );
	readBool( &def->enableTwistLimit );
	readFloat( &def->lowerTwistAngle );
	readFloat( &def->upperTwistAngle );
	readBool( &def->enableMotor );
	readFloat( &def->maxMotorTorque );
	readVector( &def->motorVelocity );
}

static void readWeld( b3WeldJointDef* def )
{
	readFloat( &def->linearHertz );
	readFloat( &def->angularHertz );
	readFloat( &def->linearDampingRatio );
	readFloat( &def->angularDampingRatio );
}

static void readWheel( b3WheelJointDef* def )
{
	readBool( &def->enableSuspensionSpring );
	readFloat( &def->suspensionHertz );
	readFloat( &def->suspensionDampingRatio );
	readBool( &def->enableSuspensionLimit );
	readFloat( &def->lowerSuspensionLimit );
	readFloat( &def->upperSuspensionLimit );
	readBool( &def->enableSpinMotor );
	readFloat( &def->maxSpinTorque );
	readFloat( &def->spinSpeed );
	readBool( &def->enableSteering );
	readFloat( &def->steeringHertz );
	readFloat( &def->steeringDampingRatio );
	readFloat( &def->targetSteeringAngle );
	readFloat( &def->maxSteeringTorque );
	readBool( &def->enableSteeringLimit );
	readFloat( &def->lowerSteeringLimit );
	readFloat( &def->upperSteeringLimit );
}

typedef union JointDef
{
	b3ParallelJointDef parallel;
	b3DistanceJointDef distance;
	b3FilterJointDef filter;
	b3MotorJointDef motor;
	b3PrismaticJointDef prismatic;
	b3RevoluteJointDef revolute;
	b3SphericalJointDef spherical;
	b3WeldJointDef weld;
	b3WheelJointDef wheel;
} JointDef;

// Every joint definition starts with its base, so `base` reads it for any joint type.
static b3JointDef* readJointDef( JointDef* def, b3JointType type )
{
	nextInput = input;
	b3JointDef* base = &def->distance.base;
	switch ( type )
	{
		case b3_parallelJoint:
			def->parallel = b3DefaultParallelJointDef();
			readBase( base );
			readParallel( &def->parallel );
			break;
		case b3_distanceJoint:
			def->distance = b3DefaultDistanceJointDef();
			readBase( base );
			readDistance( &def->distance );
			break;
		case b3_filterJoint:
			def->filter = b3DefaultFilterJointDef();
			readBase( base );
			break;
		case b3_motorJoint:
			def->motor = b3DefaultMotorJointDef();
			readBase( base );
			readMotor( &def->motor );
			break;
		case b3_prismaticJoint:
			def->prismatic = b3DefaultPrismaticJointDef();
			readBase( base );
			readPrismatic( &def->prismatic );
			break;
		case b3_revoluteJoint:
			def->revolute = b3DefaultRevoluteJointDef();
			readBase( base );
			readRevolute( &def->revolute );
			break;
		case b3_sphericalJoint:
			def->spherical = b3DefaultSphericalJointDef();
			readBase( base );
			readSpherical( &def->spherical );
			break;
		case b3_weldJoint:
			def->weld = b3DefaultWeldJointDef();
			readBase( base );
			readWeld( &def->weld );
			break;
		case b3_wheelJoint:
			def->wheel = b3DefaultWheelJointDef();
			readBase( base );
			readWheel( &def->wheel );
			break;
	}
	return base;
}

// Reads the joint's settings from the input buffer. Writes the new joint's id as two numbers.
EMSCRIPTEN_KEEPALIVE int32_t* createJoint( uint32_t world, int type, int32_t indexA, int32_t tagA, int32_t indexB,
										   int32_t tagB, int32_t jointId )
{
	b3WorldId worldId = b3LoadWorldId( world );
	JointDef def;
	b3JointDef* base = readJointDef( &def, (b3JointType)type );
	base->bodyIdA = loadBodyId( indexA, tagA );
	base->bodyIdB = loadBodyId( indexB, tagB );
	base->userData = (void*)(intptr_t)jointId;
	b3JointId created = b3_nullJointId;
	switch ( (b3JointType)type )
	{
		case b3_parallelJoint:
			created = b3CreateParallelJoint( worldId, &def.parallel );
			break;
		case b3_distanceJoint:
			created = b3CreateDistanceJoint( worldId, &def.distance );
			break;
		case b3_filterJoint:
			created = b3CreateFilterJoint( worldId, &def.filter );
			break;
		case b3_motorJoint:
			created = b3CreateMotorJoint( worldId, &def.motor );
			break;
		case b3_prismaticJoint:
			created = b3CreatePrismaticJoint( worldId, &def.prismatic );
			break;
		case b3_revoluteJoint:
			created = b3CreateRevoluteJoint( worldId, &def.revolute );
			break;
		case b3_sphericalJoint:
			created = b3CreateSphericalJoint( worldId, &def.spherical );
			break;
		case b3_weldJoint:
			created = b3CreateWeldJoint( worldId, &def.weld );
			break;
		case b3_wheelJoint:
			created = b3CreateWheelJoint( worldId, &def.wheel );
			break;
	}
	return writeId( b3StoreJointId( created ) );
}

// Reads the joint's full settings from the input buffer, the same as `createJoint`, and applies them
// to the existing joint.
EMSCRIPTEN_KEEPALIVE void updateJoint( int32_t index, int32_t tag, int type )
{
	b3JointId jointId = loadJointId( index, tag );
	JointDef def;
	b3JointDef* base = readJointDef( &def, (b3JointType)type );
	b3Joint_SetLocalFrameA( jointId, base->localFrameA );
	b3Joint_SetLocalFrameB( jointId, base->localFrameB );
	b3Joint_SetForceThreshold( jointId, base->forceThreshold );
	b3Joint_SetTorqueThreshold( jointId, base->torqueThreshold );
	b3Joint_SetConstraintTuning( jointId, base->constraintHertz, base->constraintDampingRatio );
	b3Joint_SetCollideConnected( jointId, base->collideConnected );
	switch ( (b3JointType)type )
	{
		case b3_parallelJoint:
			b3ParallelJoint_SetSpringHertz( jointId, def.parallel.hertz );
			b3ParallelJoint_SetSpringDampingRatio( jointId, def.parallel.dampingRatio );
			b3ParallelJoint_SetMaxTorque( jointId, def.parallel.maxTorque );
			break;
		case b3_distanceJoint:
		{
			b3DistanceJointDef* distance = &def.distance;
			// setting the length or its range drops the joint's accumulated impulse, even when they
			// don't change
			if ( distance->length != b3DistanceJoint_GetLength( jointId ) )
			{
				b3DistanceJoint_SetLength( jointId, distance->length );
			}
			if ( distance->minLength != b3DistanceJoint_GetMinLength( jointId ) ||
				 distance->maxLength != b3DistanceJoint_GetMaxLength( jointId ) )
			{
				b3DistanceJoint_SetLengthRange( jointId, distance->minLength, distance->maxLength );
			}
			b3DistanceJoint_EnableSpring( jointId, distance->enableSpring );
			b3DistanceJoint_SetSpringForceRange( jointId, distance->lowerSpringForce, distance->upperSpringForce );
			b3DistanceJoint_SetSpringHertz( jointId, distance->hertz );
			b3DistanceJoint_SetSpringDampingRatio( jointId, distance->dampingRatio );
			b3DistanceJoint_EnableLimit( jointId, distance->enableLimit );
			b3DistanceJoint_EnableMotor( jointId, distance->enableMotor );
			b3DistanceJoint_SetMaxMotorForce( jointId, distance->maxMotorForce );
			b3DistanceJoint_SetMotorSpeed( jointId, distance->motorSpeed );
			break;
		}
		case b3_filterJoint:
			break;
		case b3_motorJoint:
		{
			b3MotorJointDef* motor = &def.motor;
			b3MotorJoint_SetLinearVelocity( jointId, motor->linearVelocity );
			b3MotorJoint_SetMaxVelocityForce( jointId, motor->maxVelocityForce );
			b3MotorJoint_SetAngularVelocity( jointId, motor->angularVelocity );
			b3MotorJoint_SetMaxVelocityTorque( jointId, motor->maxVelocityTorque );
			b3MotorJoint_SetLinearHertz( jointId, motor->linearHertz );
			b3MotorJoint_SetLinearDampingRatio( jointId, motor->linearDampingRatio );
			b3MotorJoint_SetMaxSpringForce( jointId, motor->maxSpringForce );
			b3MotorJoint_SetAngularHertz( jointId, motor->angularHertz );
			b3MotorJoint_SetAngularDampingRatio( jointId, motor->angularDampingRatio );
			b3MotorJoint_SetMaxSpringTorque( jointId, motor->maxSpringTorque );
			break;
		}
		case b3_prismaticJoint:
		{
			b3PrismaticJointDef* prismatic = &def.prismatic;
			b3PrismaticJoint_EnableSpring( jointId, prismatic->enableSpring );
			b3PrismaticJoint_SetSpringHertz( jointId, prismatic->hertz );
			b3PrismaticJoint_SetSpringDampingRatio( jointId, prismatic->dampingRatio );
			b3PrismaticJoint_SetTargetTranslation( jointId, prismatic->targetTranslation );
			b3PrismaticJoint_EnableLimit( jointId, prismatic->enableLimit );
			b3PrismaticJoint_SetLimits( jointId, prismatic->lowerTranslation, prismatic->upperTranslation );
			b3PrismaticJoint_EnableMotor( jointId, prismatic->enableMotor );
			b3PrismaticJoint_SetMaxMotorForce( jointId, prismatic->maxMotorForce );
			b3PrismaticJoint_SetMotorSpeed( jointId, prismatic->motorSpeed );
			break;
		}
		case b3_revoluteJoint:
		{
			b3RevoluteJointDef* revolute = &def.revolute;
			b3RevoluteJoint_SetTargetAngle( jointId, revolute->targetAngle );
			b3RevoluteJoint_EnableSpring( jointId, revolute->enableSpring );
			b3RevoluteJoint_SetSpringHertz( jointId, revolute->hertz );
			b3RevoluteJoint_SetSpringDampingRatio( jointId, revolute->dampingRatio );
			b3RevoluteJoint_EnableLimit( jointId, revolute->enableLimit );
			b3RevoluteJoint_SetLimits( jointId, revolute->lowerAngle, revolute->upperAngle );
			b3RevoluteJoint_EnableMotor( jointId, revolute->enableMotor );
			b3RevoluteJoint_SetMaxMotorTorque( jointId, revolute->maxMotorTorque );
			b3RevoluteJoint_SetMotorSpeed( jointId, revolute->motorSpeed );
			break;
		}
		case b3_sphericalJoint:
		{
			b3SphericalJointDef* spherical = &def.spherical;
			b3SphericalJoint_EnableSpring( jointId, spherical->enableSpring );
			b3SphericalJoint_SetSpringHertz( jointId, spherical->hertz );
			b3SphericalJoint_SetSpringDampingRatio( jointId, spherical->dampingRatio );
			b3SphericalJoint_SetTargetRotation( jointId, spherical->targetRotation );
			b3SphericalJoint_EnableConeLimit( jointId, spherical->enableConeLimit );
			b3SphericalJoint_SetConeLimit( jointId, spherical->coneAngle );
			b3SphericalJoint_EnableTwistLimit( jointId, spherical->enableTwistLimit );
			b3SphericalJoint_SetTwistLimits( jointId, spherical->lowerTwistAngle, spherical->upperTwistAngle );
			b3SphericalJoint_EnableMotor( jointId, spherical->enableMotor );
			b3SphericalJoint_SetMaxMotorTorque( jointId, spherical->maxMotorTorque );
			b3SphericalJoint_SetMotorVelocity( jointId, spherical->motorVelocity );
			break;
		}
		case b3_weldJoint:
			b3WeldJoint_SetLinearHertz( jointId, def.weld.linearHertz );
			b3WeldJoint_SetAngularHertz( jointId, def.weld.angularHertz );
			b3WeldJoint_SetLinearDampingRatio( jointId, def.weld.linearDampingRatio );
			b3WeldJoint_SetAngularDampingRatio( jointId, def.weld.angularDampingRatio );
			break;
		case b3_wheelJoint:
		{
			b3WheelJointDef* wheel = &def.wheel;
			b3WheelJoint_EnableSuspension( jointId, wheel->enableSuspensionSpring );
			b3WheelJoint_SetSuspensionHertz( jointId, wheel->suspensionHertz );
			b3WheelJoint_SetSuspensionDampingRatio( jointId, wheel->suspensionDampingRatio );
			b3WheelJoint_EnableSuspensionLimit( jointId, wheel->enableSuspensionLimit );
			b3WheelJoint_SetSuspensionLimits( jointId, wheel->lowerSuspensionLimit, wheel->upperSuspensionLimit );
			b3WheelJoint_EnableSpinMotor( jointId, wheel->enableSpinMotor );
			b3WheelJoint_SetMaxSpinTorque( jointId, wheel->maxSpinTorque );
			b3WheelJoint_SetSpinMotorSpeed( jointId, wheel->spinSpeed );
			b3WheelJoint_EnableSteering( jointId, wheel->enableSteering );
			b3WheelJoint_SetSteeringHertz( jointId, wheel->steeringHertz );
			b3WheelJoint_SetSteeringDampingRatio( jointId, wheel->steeringDampingRatio );
			b3WheelJoint_SetTargetSteeringAngle( jointId, wheel->targetSteeringAngle );
			b3WheelJoint_SetMaxSteeringTorque( jointId, wheel->maxSteeringTorque );
			b3WheelJoint_EnableSteeringLimit( jointId, wheel->enableSteeringLimit );
			b3WheelJoint_SetSteeringLimits( jointId, wheel->lowerSteeringLimit, wheel->upperSteeringLimit );
			break;
		}
	}
	b3Joint_WakeBodies( jointId );
}

// Writes the constraint force x, y, z, constraint torque x, y, z, linear separation, and angular
// separation, then up to five readings that depend on the joint type.
EMSCRIPTEN_KEEPALIVE float* readJoint( int32_t index, int32_t tag, int type )
{
	b3JointId jointId = loadJointId( index, tag );
	b3Vec3 force = b3Joint_GetConstraintForce( jointId );
	b3Vec3 torque = b3Joint_GetConstraintTorque( jointId );
	float* written = reserveOutput( 13 * sizeof( float ) );
	written[0] = force.x;
	written[1] = force.y;
	written[2] = force.z;
	written[3] = torque.x;
	written[4] = torque.y;
	written[5] = torque.z;
	written[6] = b3Joint_GetLinearSeparation( jointId );
	written[7] = b3Joint_GetAngularSeparation( jointId );
	float* extra = written + 8;
	switch ( (b3JointType)type )
	{
		case b3_distanceJoint:
			extra[0] = b3DistanceJoint_GetCurrentLength( jointId );
			extra[1] = b3DistanceJoint_GetMotorForce( jointId );
			break;
		case b3_prismaticJoint:
			extra[0] = b3PrismaticJoint_GetTranslation( jointId );
			extra[1] = b3PrismaticJoint_GetSpeed( jointId );
			extra[2] = b3PrismaticJoint_GetMotorForce( jointId );
			break;
		case b3_revoluteJoint:
			extra[0] = b3RevoluteJoint_GetAngle( jointId );
			extra[1] = b3RevoluteJoint_GetMotorTorque( jointId );
			break;
		case b3_sphericalJoint:
		{
			b3Vec3 motorTorque = b3SphericalJoint_GetMotorTorque( jointId );
			extra[0] = b3SphericalJoint_GetConeAngle( jointId );
			extra[1] = b3SphericalJoint_GetTwistAngle( jointId );
			extra[2] = motorTorque.x;
			extra[3] = motorTorque.y;
			extra[4] = motorTorque.z;
			break;
		}
		case b3_wheelJoint:
			extra[0] = b3WheelJoint_GetSpinSpeed( jointId );
			extra[1] = b3WheelJoint_GetSpinTorque( jointId );
			extra[2] = b3WheelJoint_GetSteeringAngle( jointId );
			extra[3] = b3WheelJoint_GetSteeringTorque( jointId );
			break;
		default:
			break;
	}
	return written;
}

EMSCRIPTEN_KEEPALIVE void destroyJoint( int32_t index, int32_t tag )
{
	b3JointId jointId = loadJointId( index, tag );
	if ( b3Joint_IsValid( jointId ) )
	{
		b3DestroyJoint( jointId, true );
	}
}

// A native snapshot starts with this, then the ids of the kept bodies, the dropped bodies, and the
// joints (two numbers each, as JavaScript holds them), the tracked shapes, the passing pairs, the
// geometry, and last Box3D's own snapshot image. Box3D's image only refers to hull, mesh, height
// field, and compound geometry by index, so the geometry is a table of each blob's kind and size,
// followed by the blobs, each padded to 4 bytes.
typedef struct SnapshotHeader
{
	int32_t magic;
	int32_t size;
	int32_t bodyCount;
	int32_t droppedCount;
	int32_t jointCount;
	int32_t shapeCapacity;
	int32_t passingCount;
	int32_t geometryCount;
	int32_t geometrySize;
	int32_t box3dSize;
} SnapshotHeader;

typedef struct SnapshotGeometry
{
	int32_t kind;
	int32_t byteCount;
} SnapshotGeometry;

static const int32_t snapshotMagic = 0x33544e41;

typedef struct SnapshotLayout
{
	int64_t shapesOffset;
	int64_t passingOffset;
	int64_t geometryOffset;
	int64_t box3dOffset;
	int64_t size;
} SnapshotLayout;

static SnapshotLayout layOutSnapshot( const SnapshotHeader* header )
{
	SnapshotLayout layout;
	layout.shapesOffset = (int64_t)sizeof( SnapshotHeader ) +
						  ( (int64_t)header->bodyCount + header->droppedCount + header->jointCount ) * 2 * sizeof( int32_t );
	layout.passingOffset = layout.shapesOffset + (int64_t)header->shapeCapacity * sizeof( TrackedShape );
	layout.geometryOffset = layout.passingOffset + (int64_t)header->passingCount * sizeof( PassingPair );
	layout.box3dOffset = layout.geometryOffset + header->geometrySize;
	layout.size = layout.box3dOffset + header->box3dSize;
	return layout;
}

static int padTo4( int byteCount )
{
	return ( byteCount + 3 ) & ~3;
}

// Reads the ids of the kept bodies, the dropped bodies, then the joints from the input buffer. Must
// be called between steps.
EMSCRIPTEN_KEEPALIVE int32_t* createSnapshot( uint32_t world, int bodyCount, int droppedCount, int jointCount )
{
	b3WorldId worldId = b3LoadWorldId( world );
	TrackedWorld* trackedWorld = trackedWorlds + worldId.index1 - 1;
	b3Recording registryOwner = { 0 };
	b3RecBuffer box3dImage = { 0 };
	b3SerializeWorld( b3GetWorldFromId( worldId ), &box3dImage, &registryOwner );
	b3GeometryRegistry* registry = &registryOwner.registry;
	int geometrySize = registry->count * (int)sizeof( SnapshotGeometry );
	for ( int index = 0; index < registry->count; ++index )
	{
		geometrySize += padTo4( registry->entries[index].byteCount );
	}

	SnapshotHeader header = { snapshotMagic,
							  0,
							  bodyCount,
							  droppedCount,
							  jointCount,
							  trackedWorld->shapeCapacity,
							  trackedWorld->passingCount,
							  registry->count,
							  geometrySize,
							  box3dImage.size };
	SnapshotLayout layout = layOutSnapshot( &header );
	header.size = (int32_t)layout.size;
	uint8_t* image = reserveOutput( header.size );
	memcpy( image, &header, sizeof( header ) );
	memcpy( image + sizeof( header ), input, layout.shapesOffset - sizeof( header ) );
	memcpy( image + layout.shapesOffset, trackedWorld->shapes, layout.passingOffset - layout.shapesOffset );
	memcpy( image + layout.passingOffset, trackedWorld->passingPairs, layout.geometryOffset - layout.passingOffset );
	SnapshotGeometry* table = (SnapshotGeometry*)( image + layout.geometryOffset );
	uint8_t* blob = (uint8_t*)( table + registry->count );
	for ( int index = 0; index < registry->count; ++index )
	{
		b3GeometryEntry* entry = registry->entries + index;
		table[index] = ( SnapshotGeometry ){ (int32_t)entry->kind, entry->byteCount };
		memset( blob, 0, padTo4( entry->byteCount ) );
		memcpy( blob, entry->bytes, entry->byteCount );
		blob += padTo4( entry->byteCount );
	}
	memcpy( image + layout.box3dOffset, box3dImage.data, box3dImage.size );
	b3FreeRegistry( registry );
	b3RecBufFree( &box3dImage );
	return (int32_t*)image;
}

// Copies the snapshot's geometry into the slots Box3D's restore reads it from, or returns NULL if the
// geometry section doesn't add up. Free the slots with `freeSlots`.
static b3RegistrySlot* readSlots( const uint8_t* image, const SnapshotHeader* header )
{
	SnapshotLayout layout = layOutSnapshot( header );
	int64_t tableSize = (int64_t)header->geometryCount * sizeof( SnapshotGeometry );
	if ( tableSize > header->geometrySize )
	{
		return NULL;
	}
	const SnapshotGeometry* table = (const SnapshotGeometry*)( image + layout.geometryOffset );
	b3RegistrySlot* slots = calloc( header->geometryCount ? header->geometryCount : 1, sizeof( b3RegistrySlot ) );
	int64_t blobOffset = layout.geometryOffset + tableSize;
	for ( int index = 0; index < header->geometryCount; ++index )
	{
		SnapshotGeometry geometry = table[index];
		if ( geometry.kind < b3_geometryHull || geometry.kind > b3_geometryCompound || geometry.byteCount <= 0 ||
			 blobOffset + padTo4( geometry.byteCount ) > layout.box3dOffset )
		{
			for ( int freedIndex = 0; freedIndex < index; ++freedIndex )
			{
				b3Free( slots[freedIndex].bytes, slots[freedIndex].byteCount );
			}
			free( slots );
			return NULL;
		}
		// Box3D frees restored geometry with `b3Free`, so it must come from `b3Alloc`.
		uint8_t* bytes = b3Alloc( geometry.byteCount );
		memcpy( bytes, image + blobOffset, geometry.byteCount );
		slots[index] = ( b3RegistrySlot ){ (b3GeometryKind)geometry.kind, geometry.byteCount, bytes, NULL };
		blobOffset += padTo4( geometry.byteCount );
	}
	return slots;
}

static void freeSlots( b3RegistrySlot* slots, int count )
{
	for ( int index = 0; index < count; ++index )
	{
		b3Free( slots[index].bytes, slots[index].byteCount );
		if ( slots[index].live )
		{
			b3Free( slots[index].live, slots[index].byteCount );
		}
	}
	free( slots );
}

static bool deserializeWorld( const uint8_t* image, const SnapshotHeader* header, b3RegistrySlot* slots,
							  b3WorldId worldId )
{
	b3RecReader reader = { 0 };
	reader.slots = slots;
	reader.slotCount = header->geometryCount;
	return b3DeserializeIntoShell( image + layOutSnapshot( header ).box3dOffset, header->box3dSize,
								   b3GetWorldFromId( worldId ), &reader );
}

// Checks a snapshot in the input buffer by loading it into a throwaway world, since a restore that
// fails partway leaves the world unusable.
EMSCRIPTEN_KEEPALIVE bool isValidSnapshot( int size )
{
	SnapshotHeader header;
	if ( size < (int)sizeof( header ) )
	{
		return false;
	}
	memcpy( &header, input, sizeof( header ) );
	if ( header.magic != snapshotMagic || header.size != size || header.bodyCount < 0 || header.droppedCount < 0 ||
		 header.jointCount < 0 || header.shapeCapacity < 0 || header.passingCount < 0 || header.geometryCount < 0 ||
		 header.geometrySize < 0 || header.box3dSize < 0 || layOutSnapshot( &header ).size != size )
	{
		return false;
	}
	b3RegistrySlot* slots = readSlots( input, &header );
	if ( !slots )
	{
		return false;
	}
	b3WorldDef def = b3DefaultWorldDef();
	b3WorldId scratchId = b3CreateWorld( &def );
	bool isValid = deserializeWorld( input, &header, slots, scratchId );
	b3DestroyWorld( scratchId );
	freeSlots( slots, header.geometryCount );
	return isValid;
}

// Stored ids name the world they were made in, which `reset` may have replaced.
static uint64_t moveIdToWorld( const int32_t* savedId, uint16_t world0 )
{
	return loadId( savedId[0], ( (uint32_t)world0 << 16 ) | ( (uint32_t)savedId[1] & 0xFFFF ) );
}

// Gives each restored mesh, height field, and compound shape its own copy of its geometry, owned by
// its body like geometry from `addMesh`, since restored shapes point into `slots`.
static void ownRestoredGeometry( b3World* world, b3RegistrySlot* slots, int slotCount )
{
	for ( int index = 0; index < world->shapes.count; ++index )
	{
		b3Shape* shape = world->shapes.data + index;
		if ( shape->id != index ||
			 ( shape->type != b3_meshShape && shape->type != b3_heightShape && shape->type != b3_compoundShape ) )
		{
			continue;
		}
		const void* restored = shape->type == b3_meshShape		 ? (const void*)shape->mesh.data
							   : shape->type == b3_heightShape ? (const void*)shape->heightField
															   : (const void*)shape->compound;
		for ( int slotIndex = 0; slotIndex < slotCount; ++slotIndex )
		{
			b3RegistrySlot* slot = slots + slotIndex;
			if ( slot->bytes != restored && slot->live != restored )
			{
				continue;
			}
			uint8_t* copy = b3Alloc( slot->byteCount );
			memcpy( copy, slot->bytes, slot->byteCount );
			b3BodyId bodyId = b3Shape_GetBody( ( b3ShapeId ){ index + 1, world->worldId, shape->generation } );
			if ( shape->type == b3_meshShape )
			{
				shape->mesh.data = (b3MeshData*)copy;
				ownGeometry( bodyId, (b3MeshData*)copy, NULL, NULL );
			}
			else if ( shape->type == b3_heightShape )
			{
				shape->heightField = (b3HeightFieldData*)copy;
				ownGeometry( bodyId, NULL, (b3HeightFieldData*)copy, NULL );
			}
			else
			{
				b3CompoundData* compound = b3ConvertBytesToCompound( copy, slot->byteCount );
				shape->compound = compound;
				ownGeometry( bodyId, NULL, NULL, compound );
			}
			break;
		}
	}
}

// Restores a snapshot from the input buffer that `isValidSnapshot` accepted. After the snapshot, at
// the next multiple of 4 bytes, the input holds the entity id for each kept body and then the
// joint id for each joint, which replace the ones they had when the snapshot was made. Destroys
// the dropped bodies and returns the restored ids of the kept bodies and then the joints, or NULL
// without changing the world if the snapshot is invalid.
EMSCRIPTEN_KEEPALIVE int32_t* restoreSnapshot( uint32_t world, int size )
{
	if ( !isValidSnapshot( size ) )
	{
		return NULL;
	}
	b3WorldId worldId = b3LoadWorldId( world );
	uint16_t world0 = worldId.index1 - 1;
	const uint8_t* image = input;
	SnapshotHeader header;
	memcpy( &header, image, sizeof( header ) );
	SnapshotLayout layout = layOutSnapshot( &header );

	b3World* box3dWorld = b3GetWorldFromId( worldId );
	// Box3D keeps a shape's debug drawing across a restore when the restored shape has the same slot
	// and generation, which a shape from another world can have with different geometry.
	for ( int index = 0; index < box3dWorld->shapes.count; ++index )
	{
		b3Shape* shape = box3dWorld->shapes.data + index;
		if ( shape->id == index && shape->userShape )
		{
			box3dWorld->destroyDebugShape( shape->userShape, box3dWorld->userDebugShapeContext );
			shape->userShape = NULL;
		}
	}
	b3RegistrySlot* slots = readSlots( image, &header );
	deserializeWorld( image, &header, slots, worldId );
	freeGeometry( isOwnedByWorld, world );
	ownRestoredGeometry( box3dWorld, slots, header.geometryCount );
	freeSlots( slots, header.geometryCount );

	TrackedWorld* trackedWorld = trackedWorlds + world0;
	trackedWorld->shapes = realloc( trackedWorld->shapes, ( header.shapeCapacity ? header.shapeCapacity : 1 ) *
															  sizeof( TrackedShape ) );
	trackedWorld->shapeCapacity = header.shapeCapacity;
	memcpy( trackedWorld->shapes, image + layout.shapesOffset, layout.passingOffset - layout.shapesOffset );
	if ( header.passingCount > trackedWorld->passingCapacity )
	{
		trackedWorld->passingCapacity = header.passingCount;
		trackedWorld->passingPairs = realloc( trackedWorld->passingPairs, header.passingCount * sizeof( PassingPair ) );
	}
	trackedWorld->passingCount = header.passingCount;
	memcpy( trackedWorld->passingPairs, image + layout.passingOffset, layout.geometryOffset - layout.passingOffset );
	for ( int index = 0; index < header.passingCount; ++index )
	{
		trackedWorld->passingPairs[index].oneWayShape.world0 = world0;
		trackedWorld->passingPairs[index].otherShape.world0 = world0;
	}

	const int32_t* savedIds = (const int32_t*)( image + sizeof( header ) );
	const int32_t* userValues = (const int32_t*)( image + padTo4( size ) );
	int32_t* restoredIds = reserveOutput( ( header.bodyCount + header.jointCount ) * 2 * sizeof( int32_t ) );
	for ( int index = 0; index < header.bodyCount; ++index )
	{
		uint64_t stored = moveIdToWorld( savedIds + 2 * index, world0 );
		b3BodyId bodyId = b3LoadBodyId( stored );
		void* userData = (void*)(intptr_t)userValues[index];
		b3Body_SetUserData( bodyId, userData );
		int shapeCount;
		b3ShapeId* shapeIds = readBodyShapes( bodyId, &shapeCount );
		for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
		{
			b3Shape_SetUserData( shapeIds[shapeIndex], userData );
		}
		free( shapeIds );
		restoredIds[2 * index] = (int32_t)( stored >> 32 );
		restoredIds[2 * index + 1] = (int32_t)( stored & 0xFFFFFFFF );
	}
	for ( int index = 0; index < header.droppedCount; ++index )
	{
		uint64_t stored = moveIdToWorld( savedIds + 2 * ( header.bodyCount + index ), world0 );
		b3DestroyBody( b3LoadBodyId( stored ) );
		freeGeometry( isOwnedByBody, stored );
	}
	for ( int index = 0; index < header.jointCount; ++index )
	{
		uint64_t stored = moveIdToWorld( savedIds + 2 * ( header.bodyCount + header.droppedCount + index ), world0 );
		b3Joint_SetUserData( b3LoadJointId( stored ), (void*)(intptr_t)userValues[header.bodyCount + index] );
		restoredIds[2 * ( header.bodyCount + index )] = (int32_t)( stored >> 32 );
		restoredIds[2 * ( header.bodyCount + index ) + 1] = (int32_t)( stored & 0xFFFFFFFF );
	}
	return restoredIds;
}

EMSCRIPTEN_KEEPALIVE int32_t getAwakeBodyCount( uint32_t world )
{
	return b3World_GetAwakeBodyCount( b3LoadWorldId( world ) );
}

EMSCRIPTEN_KEEPALIVE float* readProfile( uint32_t world )
{
	b3Profile profile = b3World_GetProfile( b3LoadWorldId( world ) );
	float* written = reserveOutput( sizeof( b3Profile ) );
	memcpy( written, &profile, sizeof( b3Profile ) );
	return written;
}

// Every counter is an int, so JavaScript reads the struct as is.
EMSCRIPTEN_KEEPALIVE int32_t* readCounters( uint32_t world )
{
	b3Counters counters = b3World_GetCounters( b3LoadWorldId( world ) );
	int32_t* written = reserveOutput( sizeof( b3Counters ) );
	memcpy( written, &counters, sizeof( b3Counters ) );
	return written;
}

typedef struct FloatList
{
	float* values;
	int count;
	int capacity;
} FloatList;

static void pushFloats( FloatList* list, const float* values, int count )
{
	if ( list->count + count > list->capacity )
	{
		list->capacity = ( list->count + count ) * 2;
		list->values = realloc( list->values, list->capacity * sizeof( float ) );
	}
	memcpy( list->values + list->count, values, count * sizeof( float ) );
	list->count += count;
}

static void pushVector( FloatList* list, b3Vec3 vector )
{
	pushFloats( list, &vector.x, 3 );
}

// Box3D doesn't draw shapes itself. It asks for a handle to each shape the first time it draws it,
// and hands that handle back on every later draw until the shape is destroyed or changed. Each
// handle here is the shape's geometry in its body's frame, built once into these lists.
static FloatList debugSpheres;
static FloatList debugCapsules;
static FloatList debugTriangles;

static void addDebugSphere( b3Transform transform, b3Sphere sphere )
{
	pushVector( &debugSpheres, b3TransformPoint( transform, sphere.center ) );
	pushFloats( &debugSpheres, &sphere.radius, 1 );
}

static void addDebugCapsule( b3Transform transform, b3Capsule capsule )
{
	pushVector( &debugCapsules, b3TransformPoint( transform, capsule.center1 ) );
	pushVector( &debugCapsules, b3TransformPoint( transform, capsule.center2 ) );
	pushFloats( &debugCapsules, &capsule.radius, 1 );
}

static void addDebugTriangle( b3Transform transform, b3Vec3 a, b3Vec3 b, b3Vec3 c )
{
	pushVector( &debugTriangles, b3TransformPoint( transform, a ) );
	pushVector( &debugTriangles, b3TransformPoint( transform, b ) );
	pushVector( &debugTriangles, b3TransformPoint( transform, c ) );
}

// Splits each face, a convex polygon, into a fan of triangles.
static void addDebugHull( b3Transform transform, const b3HullData* hull )
{
	const b3HullFace* faces = b3GetHullFaces( hull );
	const b3HullHalfEdge* edges = b3GetHullEdges( hull );
	const b3Vec3* points = b3GetHullPoints( hull );
	for ( int faceIndex = 0; faceIndex < hull->faceCount; ++faceIndex )
	{
		const b3HullHalfEdge* first = edges + faces[faceIndex].edge;
		const b3HullHalfEdge* edge = edges + first->next;
		for ( const b3HullHalfEdge* next = edges + edge->next; next != first; next = edges + next->next )
		{
			addDebugTriangle( transform, points[first->origin], points[edge->origin], points[next->origin] );
			edge = next;
		}
	}
}

static bool collectDebugTriangle( b3Vec3 a, b3Vec3 b, b3Vec3 c, int triangleIndex, void* context )
{
	addDebugTriangle( *(b3Transform*)context, a, b, c );
	return true;
}

static void addDebugMesh( b3Transform transform, b3Mesh mesh )
{
	b3QueryMesh( &mesh, b3ComputeMeshAABB( mesh.data, b3Transform_identity, mesh.scale ), collectDebugTriangle,
				 &transform );
}

static void addDebugCompound( const b3CompoundData* compound )
{
	int childCount = compound->capsuleCount + compound->hullCount + compound->meshCount + compound->sphereCount;
	for ( int index = 0; index < childCount; ++index )
	{
		b3ChildShape child = b3GetCompoundChild( compound, index );
		if ( child.type == b3_capsuleShape )
		{
			addDebugCapsule( child.transform, child.capsule );
		}
		else if ( child.type == b3_hullShape )
		{
			addDebugHull( child.transform, child.hull );
		}
		else if ( child.type == b3_meshShape )
		{
			addDebugMesh( child.transform, child.mesh );
		}
		else
		{
			addDebugSphere( child.transform, child.sphere );
		}
	}
}

typedef struct DebugShape
{
	b3ShapeId shapeId;
	int count;
	float values[];
} DebugShape;

// Builds the sphere count and spheres, the capsule count and capsules, then the triangle count and
// triangles. The geometry pointers in `debugShape` point into Box3D's shape array, which moves as
// shapes are added, so they are only read here.
static void* createDebugShape( const b3DebugShape* debugShape, void* context )
{
	debugSpheres.count = 0;
	debugCapsules.count = 0;
	debugTriangles.count = 0;
	if ( debugShape->type == b3_sphereShape )
	{
		addDebugSphere( b3Transform_identity, *debugShape->sphere );
	}
	else if ( debugShape->type == b3_capsuleShape )
	{
		addDebugCapsule( b3Transform_identity, *debugShape->capsule );
	}
	else if ( debugShape->type == b3_hullShape )
	{
		addDebugHull( b3Transform_identity, debugShape->hull );
	}
	else if ( debugShape->type == b3_meshShape )
	{
		addDebugMesh( b3Transform_identity, *debugShape->mesh );
	}
	else if ( debugShape->type == b3_heightShape )
	{
		b3Transform transform = b3Transform_identity;
		b3QueryHeightField( debugShape->heightField, b3ComputeHeightFieldAABB( debugShape->heightField, transform ),
							collectDebugTriangle, &transform );
	}
	else
	{
		addDebugCompound( debugShape->compound );
	}
	int count = 3 + debugSpheres.count + debugCapsules.count + debugTriangles.count;
	DebugShape* handle = malloc( sizeof( DebugShape ) + count * sizeof( float ) );
	handle->shapeId = debugShape->shapeId;
	handle->count = count;
	float* values = handle->values;
	FloatList* lists[] = { &debugSpheres, &debugCapsules, &debugTriangles };
	int sizes[] = { 4, 7, 9 };
	for ( int index = 0; index < 3; ++index )
	{
		*values++ = lists[index]->count / sizes[index];
		memcpy( values, lists[index]->values, lists[index]->count * sizeof( float ) );
		values += lists[index]->count;
	}
	return handle;
}

static void destroyDebugShape( void* userShape, void* context )
{
	free( userShape );
}

// Debug drawing collects everything Box3D draws into one buffer of floats, so JavaScript reads it
// all after one call instead of being called once per primitive. Each primitive starts with its
// `DrawKind`. Colors are 24-bit, so floats hold them exactly.
typedef enum DrawKind
{
	drawShape,
	drawSegment,
	drawTransform,
	drawPoint,
	drawSphere,
	drawCapsule,
	drawBounds,
	drawBox,
	drawString,
} DrawKind;

static FloatList drawing;

static void pushDrawing( const float* values, int count )
{
	pushFloats( &drawing, values, count );
}

static void pushWorldTransform( b3WorldTransform transform )
{
	float values[] = { transform.p.x, transform.p.y, transform.p.z, transform.q.v.x,
					   transform.q.v.y, transform.q.v.z, transform.q.s };
	pushDrawing( values, 7 );
}

static int findReplayBody( b3RecPlayer* player, b3BodyId bodyId )
{
	int count = b3RecPlayer_GetBodyCount( player );
	for ( int index = 0; index < count; ++index )
	{
		if ( B3_ID_EQUALS( b3RecPlayer_GetBodyId( player, index ), bodyId ) )
		{
			return index;
		}
	}
	return -1;
}

// `context` is the replay player when drawing a replay, which identifies shapes by their body's
// creation order since replays don't keep entity ids. Box3D packs a material preset into the
// color's high byte.
static bool collectShape( void* userShape, b3WorldTransform transform, b3HexColor color, void* context )
{
	DebugShape* shape = userShape;
	float owner =
		context ? findReplayBody( context, b3Shape_GetBody( shape->shapeId ) ) : shapeEntity( shape->shapeId );
	float header[] = { drawShape, owner };
	pushDrawing( header, 2 );
	pushWorldTransform( transform );
	float colors[] = { (uint32_t)color & 0xFFFFFF, (uint32_t)color >> 24 };
	pushDrawing( colors, 2 );
	pushDrawing( shape->values, shape->count );
	return true;
}

static void collectSegment( b3Pos p1, b3Pos p2, b3HexColor color, void* context )
{
	float values[] = { drawSegment, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, (uint32_t)color & 0xFFFFFF };
	pushDrawing( values, 8 );
}

static void collectTransform( b3WorldTransform transform, void* context )
{
	float kind = drawTransform;
	pushDrawing( &kind, 1 );
	pushWorldTransform( transform );
}

static void collectPoint( b3Pos p, float size, b3HexColor color, void* context )
{
	float values[] = { drawPoint, p.x, p.y, p.z, size, (uint32_t)color & 0xFFFFFF };
	pushDrawing( values, 6 );
}

static void collectSphere( b3Pos p, float radius, b3HexColor color, float alpha, void* context )
{
	float values[] = { drawSphere, p.x, p.y, p.z, radius, (uint32_t)color & 0xFFFFFF, alpha };
	pushDrawing( values, 7 );
}

static void collectCapsule( b3Pos p1, b3Pos p2, float radius, b3HexColor color, float alpha, void* context )
{
	float values[] = {
		drawCapsule, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, radius, (uint32_t)color & 0xFFFFFF, alpha,
	};
	pushDrawing( values, 10 );
}

static void collectBounds( b3AABB bounds, b3HexColor color, void* context )
{
	float values[] = { drawBounds,			 bounds.lowerBound.x, bounds.lowerBound.y,		   bounds.lowerBound.z,
					   bounds.upperBound.x, bounds.upperBound.y, bounds.upperBound.z, (uint32_t)color & 0xFFFFFF };
	pushDrawing( values, 8 );
}

static void collectBox( b3Vec3 extents, b3WorldTransform transform, b3HexColor color, void* context )
{
	float values[] = { drawBox, extents.x, extents.y, extents.z };
	pushDrawing( values, 4 );
	pushWorldTransform( transform );
	float rest[] = { (uint32_t)color & 0xFFFFFF };
	pushDrawing( rest, 1 );
}

static void collectString( b3Pos p, const char* text, b3HexColor color, void* context )
{
	int length = (int)strlen( text );
	float values[] = { drawString, p.x, p.y, p.z, (uint32_t)color & 0xFFFFFF, length };
	pushDrawing( values, 6 );
	for ( int index = 0; index < length; ++index )
	{
		float character = (unsigned char)text[index];
		pushDrawing( &character, 1 );
	}
}

// Reads the drawing options JavaScript wrote to `input`: the drawing bounds, force scale, joint
// scale, then one flag per `b3DebugDraw` option, in the order they are declared.
static b3DebugDraw readDebugDraw( void* context )
{
	const float* options = input;
	b3DebugDraw draw = b3DefaultDebugDraw();
	draw.DrawShapeFcn = collectShape;
	draw.DrawSegmentFcn = collectSegment;
	draw.DrawTransformFcn = collectTransform;
	draw.DrawPointFcn = collectPoint;
	draw.DrawSphereFcn = collectSphere;
	draw.DrawCapsuleFcn = collectCapsule;
	draw.DrawBoundsFcn = collectBounds;
	draw.DrawBoxFcn = collectBox;
	draw.DrawStringFcn = collectString;
	draw.context = context;
	draw.drawingBounds = ( b3AABB ){ { options[0], options[1], options[2] }, { options[3], options[4], options[5] } };
	draw.forceScale = options[6];
	draw.jointScale = options[7];
	bool* flags[] = { &draw.drawShapes,			&draw.drawJoints,		  &draw.drawJointExtras,	&draw.drawBounds,
					  &draw.drawMass,			&draw.drawBodyNames,	  &draw.drawContacts,		&draw.drawGraphColors,
					  &draw.drawContactFeatures, &draw.drawContactNormals, &draw.drawContactForces, &draw.drawFrictionForces,
					  &draw.drawIslands };
	int flagCount = (int)( sizeof( flags ) / sizeof( flags[0] ) );
	for ( int index = 0; index < flagCount; ++index )
	{
		*flags[index] = options[8 + index] != 0.0f;
	}
	draw.drawAnchorA = options[8 + flagCount] != 0.0f;
	drawing.count = 0;
	return draw;
}

// Returns where the drawing starts and how many floats it has.
static int32_t* finishDrawing( void )
{
	int32_t* written = reserveOutput( 2 * sizeof( int32_t ) );
	written[0] = (int32_t)(intptr_t)drawing.values;
	written[1] = drawing.count;
	return written;
}

// Only draws shapes whose collision category overlaps `maskBits`.
EMSCRIPTEN_KEEPALIVE int32_t* drawWorld( uint32_t world, uint64_t maskBits )
{
	b3DebugDraw draw = readDebugDraw( NULL );
	b3World_Draw( b3LoadWorldId( world ), &draw, maskBits );
	return finishDrawing();
}

typedef enum RecordingResult
{
	recordingStarted,
	recordingAlready,
	recordingHasHooks,
	recordingHasPreSolveShapes,
} RecordingResult;

static bool hasPreSolveShapes( b3WorldId worldId )
{
	TrackedWorld* world = trackedWorlds + worldId.index1 - 1;
	for ( int index = 0; index < world->shapeCapacity; ++index )
	{
		TrackedShape* shape = world->shapes + index;
		b3ShapeId shapeId = { index + 1, worldId.index1 - 1, shape->generation };
		if ( ( shape->isOneWay || shape->enablePreSolve ) && b3Shape_IsValid( shapeId ) )
		{
			return true;
		}
	}
	return false;
}

// Replays leave out every callback, so a world can't record while callbacks change how it steps.
EMSCRIPTEN_KEEPALIVE int32_t startRecording( uint32_t world )
{
	b3WorldId worldId = b3LoadWorldId( world );
	TrackedWorld* trackedWorld = trackedWorlds + worldId.index1 - 1;
	if ( trackedWorld->recording )
	{
		return recordingAlready;
	}
	if ( trackedWorld->hasPreSolveHook || trackedWorld->hasOtherHooks )
	{
		return recordingHasHooks;
	}
	if ( hasPreSolveShapes( worldId ) )
	{
		return recordingHasPreSolveShapes;
	}
	trackedWorld->recording = b3CreateRecording( 0 );
	b3World_StartRecording( worldId, trackedWorld->recording );
	return recordingStarted;
}

EMSCRIPTEN_KEEPALIVE bool isRecordingBody( int32_t index, int32_t tag )
{
	return trackedWorlds[loadBodyId( index, tag ).world0].recording != NULL;
}

EMSCRIPTEN_KEEPALIVE bool isRecording( uint32_t world )
{
	return trackedWorlds[b3LoadWorldId( world ).index1 - 1].recording != NULL;
}

// Writes the recording's size, then its bytes. Returns NULL when the world isn't recording.
EMSCRIPTEN_KEEPALIVE int32_t* stopRecording( uint32_t world )
{
	b3WorldId worldId = b3LoadWorldId( world );
	TrackedWorld* trackedWorld = trackedWorlds + worldId.index1 - 1;
	if ( !trackedWorld->recording )
	{
		return NULL;
	}
	b3World_StopRecording( worldId );
	int size = b3Recording_GetSize( trackedWorld->recording );
	int32_t* written = reserveOutput( sizeof( int32_t ) + size );
	written[0] = size;
	memcpy( written + 1, b3Recording_GetData( trackedWorld->recording ), size );
	b3DestroyRecording( trackedWorld->recording );
	trackedWorld->recording = NULL;
	return written;
}

// Recordings are read from `input`, `size` bytes long. Replays use one worker, like the recorded
// worlds.
EMSCRIPTEN_KEEPALIVE bool validateRecording( int size )
{
	return b3ValidateReplay( input, size, 1 );
}

EMSCRIPTEN_KEEPALIVE b3RecPlayer* createReplay( int size )
{
	b3RecPlayer* player = b3RecPlayer_Create( input, size, 1 );
	if ( player )
	{
		b3RecPlayer_SetDebugShapeCallbacks( player, createDebugShape, destroyDebugShape, NULL );
	}
	return player;
}

EMSCRIPTEN_KEEPALIVE void destroyReplay( b3RecPlayer* player )
{
	b3RecPlayer_Destroy( player );
}

EMSCRIPTEN_KEEPALIVE bool stepReplayFrame( b3RecPlayer* player )
{
	return b3RecPlayer_StepFrame( player );
}

EMSCRIPTEN_KEEPALIVE void restartReplay( b3RecPlayer* player )
{
	b3RecPlayer_Restart( player );
}

EMSCRIPTEN_KEEPALIVE void seekReplayFrame( b3RecPlayer* player, int frame )
{
	b3RecPlayer_SeekFrame( player, frame );
}

EMSCRIPTEN_KEEPALIVE int32_t* readReplayStatus( b3RecPlayer* player )
{
	int32_t* written = reserveOutput( 8 * sizeof( int32_t ) );
	written[0] = b3RecPlayer_GetFrame( player );
	written[1] = b3RecPlayer_IsAtEnd( player );
	written[2] = b3RecPlayer_GetDivergeFrame( player );
	written[3] = (int32_t)b3RecPlayer_GetKeyframeBudget( player );
	written[4] = b3RecPlayer_GetKeyframeMinInterval( player );
	written[5] = b3RecPlayer_GetKeyframeInterval( player );
	written[6] = (int32_t)b3RecPlayer_GetKeyframeBytes( player );
	written[7] = b3RecPlayer_GetFrameQueryCount( player );
	return written;
}

EMSCRIPTEN_KEEPALIVE float* readReplayInfo( b3RecPlayer* player )
{
	b3RecPlayerInfo info = b3RecPlayer_GetInfo( player );
	float* written = reserveOutput( 9 * sizeof( float ) );
	float values[] = { info.frameCount,			  info.timeStep,		   info.subStepCount,
					   info.bounds.lowerBound.x, info.bounds.lowerBound.y, info.bounds.lowerBound.z,
					   info.bounds.upperBound.x, info.bounds.upperBound.y, info.bounds.upperBound.z };
	memcpy( written, values, sizeof( values ) );
	return written;
}

EMSCRIPTEN_KEEPALIVE void setReplayKeyframePolicy( b3RecPlayer* player, int budgetBytes, int minIntervalFrames )
{
	b3RecPlayer_SetKeyframePolicy( player, budgetBytes, minIntervalFrames );
}

// Writes the body count, then for each body in creation order whether it exists, then its position
// and rotation.
EMSCRIPTEN_KEEPALIVE float* readReplayBodies( b3RecPlayer* player )
{
	int count = b3RecPlayer_GetBodyCount( player );
	float* written = reserveOutput( ( 1 + 8 * count ) * sizeof( float ) );
	written[0] = count;
	for ( int index = 0; index < count; ++index )
	{
		b3BodyId bodyId = b3RecPlayer_GetBodyId( player, index );
		bool exists = b3Body_IsValid( bodyId );
		b3Pos position = exists ? b3Body_GetPosition( bodyId ) : ( b3Pos ){ 0 };
		b3Quat rotation = exists ? b3Body_GetRotation( bodyId ) : b3Quat_identity;
		float values[] = { exists, position.x, position.y, position.z, rotation.v.x, rotation.v.y, rotation.v.z, rotation.s };
		memcpy( written + 1 + 8 * index, values, sizeof( values ) );
	}
	return written;
}

typedef struct ReplayQuery
{
	int32_t type;
	uint32_t category[2];
	uint32_t mask[2];
	float bounds[6];
	float origin[3];
	float translation[3];
	int32_t hitCount;
} ReplayQuery;

typedef struct ReplayQueryHit
{
	int32_t bodyIndex;
	float point[3];
	float normal[3];
	float fraction;
} ReplayQueryHit;

// Writes the query, then each of its hits.
EMSCRIPTEN_KEEPALIVE ReplayQuery* readReplayQuery( b3RecPlayer* player, int queryIndex )
{
	b3RecQueryInfo info = b3RecPlayer_GetFrameQuery( player, queryIndex );
	ReplayQuery* query = reserveOutput( sizeof( ReplayQuery ) + info.hitCount * sizeof( ReplayQueryHit ) );
	*query = ( ReplayQuery ){
		info.type,
		{ (uint32_t)info.filter.categoryBits, (uint32_t)( info.filter.categoryBits >> 32 ) },
		{ (uint32_t)info.filter.maskBits, (uint32_t)( info.filter.maskBits >> 32 ) },
		{ info.aabb.lowerBound.x, info.aabb.lowerBound.y, info.aabb.lowerBound.z, info.aabb.upperBound.x,
		  info.aabb.upperBound.y, info.aabb.upperBound.z },
		{ info.origin.x, info.origin.y, info.origin.z },
		{ info.translation.x, info.translation.y, info.translation.z },
		info.hitCount,
	};
	ReplayQueryHit* hits = (ReplayQueryHit*)( query + 1 );
	for ( int index = 0; index < info.hitCount; ++index )
	{
		b3RecQueryHit hit = b3RecPlayer_GetFrameQueryHit( player, queryIndex, index );
		int bodyIndex = b3Shape_IsValid( hit.shape ) ? findReplayBody( player, b3Shape_GetBody( hit.shape ) ) : -1;
		hits[index] = ( ReplayQueryHit ){
			bodyIndex,
			{ hit.point.x, hit.point.y, hit.point.z },
			{ hit.normal.x, hit.normal.y, hit.normal.z },
			hit.fraction,
		};
	}
	return query;
}

// Draws the replayed world, then the queries of the last replayed frame: all of them for
// `queryIndex` -1, or none for -2. `selectedIndex` is the query to highlight, or -1 for none.
EMSCRIPTEN_KEEPALIVE int32_t* drawReplay( b3RecPlayer* player, uint64_t maskBits, int queryIndex, int selectedIndex )
{
	b3DebugDraw draw = readDebugDraw( player );
	b3World_Draw( b3RecPlayer_GetWorldId( player ), &draw, maskBits );
	if ( queryIndex != -2 )
	{
		b3RecPlayer_DrawFrameQueries( player, &draw, queryIndex, selectedIndex );
	}
	return finishDrawing();
}

static b3Vec3 loadVector( const float* values )
{
	return ( b3Vec3 ){ values[0], values[1], values[2] };
}

// Reads a transform as position x, y, z, then rotation x, y, z, w.
static b3Transform loadInputTransform( const float* values )
{
	return loadTransform( values[0], values[1], values[2], values[3], values[4], values[5], values[6] );
}

static void storeVector( float* values, b3Vec3 vector )
{
	values[0] = vector.x;
	values[1] = vector.y;
	values[2] = vector.z;
}

// Writes the lower x, y, z then upper x, y, z.
static float* writeBounds( b3AABB bounds )
{
	float* written = reserveOutput( 6 * sizeof( float ) );
	storeVector( written, bounds.lowerBound );
	storeVector( written + 3, bounds.upperBound );
	return written;
}

// Writes the mass of slot 0's sphere, capsule, or hull the same way as `readMassData`.
EMSCRIPTEN_KEEPALIVE float* computeGeometryMass( float density )
{
	const GeometrySlot* slot = &geometrySlots[0];
	if ( slot->type == b3_sphereShape )
	{
		return writeMassData( b3ComputeSphereMass( &slot->sphere, density ) );
	}
	else if ( slot->type == b3_capsuleShape )
	{
		return writeMassData( b3ComputeCapsuleMass( &slot->capsule, density ) );
	}
	return writeMassData( b3ComputeHullMass( slot->hull, density ) );
}

// Reads slot 0's transform from the input buffer.
EMSCRIPTEN_KEEPALIVE float* computeGeometryBounds( void )
{
	const GeometrySlot* slot = &geometrySlots[0];
	b3Transform transform = loadInputTransform( input );
	b3AABB bounds;
	if ( slot->type == b3_sphereShape )
	{
		bounds = b3ComputeSphereAABB( &slot->sphere, transform );
	}
	else if ( slot->type == b3_capsuleShape )
	{
		bounds = b3ComputeCapsuleAABB( &slot->capsule, transform );
	}
	else if ( slot->type == b3_hullShape )
	{
		bounds = b3ComputeHullAABB( slot->hull, transform );
	}
	else if ( slot->type == b3_meshShape )
	{
		bounds = b3ComputeMeshAABB( slot->mesh, transform, b3Vec3_one );
	}
	else if ( slot->type == b3_heightShape )
	{
		bounds = b3ComputeHeightFieldAABB( slot->heightField, transform );
	}
	else
	{
		bounds = b3ComputeCompoundAABB( slot->compound, transform );
	}
	return writeBounds( bounds );
}

// Reads slot 0's transform, then `pointCount` points (x, y, z each) in world space, which `radius`
// rounds.
EMSCRIPTEN_KEEPALIVE bool overlapGeometry( int pointCount, float radius )
{
	const GeometrySlot* slot = &geometrySlots[0];
	float* values = input;
	b3Transform transform = loadInputTransform( values );
	b3ShapeProxy proxy = { (const b3Vec3*)( values + 7 ), pointCount, radius };
	b3Mesh mesh = { slot->mesh, b3Vec3_one };
	if ( slot->type == b3_sphereShape )
	{
		return b3OverlapSphere( &slot->sphere, transform, &proxy );
	}
	else if ( slot->type == b3_capsuleShape )
	{
		return b3OverlapCapsule( &slot->capsule, transform, &proxy );
	}
	else if ( slot->type == b3_hullShape )
	{
		return b3OverlapHull( slot->hull, transform, &proxy );
	}
	else if ( slot->type == b3_meshShape )
	{
		return b3OverlapMesh( &mesh, transform, &proxy );
	}
	else if ( slot->type == b3_heightShape )
	{
		return b3OverlapHeightField( slot->heightField, transform, &proxy );
	}
	return b3OverlapCompound( slot->compound, transform, &proxy );
}

// Writes a hit flag, the point x, y, z and normal x, y, z moved into world space by `transform`, the
// fraction, the triangle index, and the compound child index.
static float* writeCastOutput( b3CastOutput cast, b3Transform transform )
{
	float* written = reserveOutput( 10 * sizeof( float ) );
	written[0] = cast.hit;
	storeVector( written + 1, b3TransformPoint( transform, cast.point ) );
	storeVector( written + 4, b3RotateVector( transform.q, cast.normal ) );
	written[7] = cast.fraction;
	written[8] = (float)cast.triangleIndex;
	written[9] = (float)cast.childIndex;
	return written;
}

// Reads slot 0's transform, then the ray's origin x, y, z, translation x, y, z, and max fraction in
// world space. `isHollow` only applies to spheres, which it hits from inside too.
EMSCRIPTEN_KEEPALIVE float* castGeometryRay( bool isHollow )
{
	const GeometrySlot* slot = &geometrySlots[0];
	float* values = input;
	b3Transform transform = loadInputTransform( values );
	b3RayCastInput ray = {
		b3InvTransformPoint( transform, loadVector( values + 7 ) ),
		b3InvRotateVector( transform.q, loadVector( values + 10 ) ),
		values[13],
	};
	b3Mesh mesh = { slot->mesh, b3Vec3_one };
	b3CastOutput cast;
	if ( slot->type == b3_sphereShape )
	{
		if ( isHollow )
		{
			// b3RayCastHollowSphere measures its fraction in distance along the normalized
			// translation instead of as a fraction of the translation, unlike every other ray cast.
			float length = b3Length( ray.translation );
			ray.maxFraction *= length;
			cast = b3RayCastHollowSphere( &slot->sphere, &ray );
			cast.fraction /= length;
		}
		else
		{
			cast = b3RayCastSphere( &slot->sphere, &ray );
		}
	}
	else if ( slot->type == b3_capsuleShape )
	{
		cast = b3RayCastCapsule( &slot->capsule, &ray );
	}
	else if ( slot->type == b3_hullShape )
	{
		cast = b3RayCastHull( slot->hull, &ray );
	}
	else if ( slot->type == b3_meshShape )
	{
		cast = b3RayCastMesh( &mesh, &ray );
	}
	else if ( slot->type == b3_heightShape )
	{
		cast = b3RayCastHeightField( slot->heightField, &ray );
	}
	else
	{
		cast = b3RayCastCompound( slot->compound, &ray );
	}
	return writeCastOutput( cast, transform );
}

// Reads slot 0's transform, the cast's translation x, y, z and max fraction in world space, then
// `pointCount` points (x, y, z each) in world space, which `radius` rounds.
EMSCRIPTEN_KEEPALIVE float* castGeometryShape( int pointCount, float radius, bool canEncroach )
{
	const GeometrySlot* slot = &geometrySlots[0];
	float* values = input;
	b3Transform transform = loadInputTransform( values );
	b3Vec3* points = (b3Vec3*)( values + 11 );
	for ( int pointIndex = 0; pointIndex < pointCount; ++pointIndex )
	{
		points[pointIndex] = b3InvTransformPoint( transform, points[pointIndex] );
	}
	b3ShapeCastInput cast = {
		{ points, pointCount, radius },
		b3InvRotateVector( transform.q, loadVector( values + 7 ) ),
		values[10],
		canEncroach,
	};
	b3Mesh mesh = { slot->mesh, b3Vec3_one };
	b3CastOutput output;
	if ( slot->type == b3_sphereShape )
	{
		output = b3ShapeCastSphere( &slot->sphere, &cast );
	}
	else if ( slot->type == b3_capsuleShape )
	{
		output = b3ShapeCastCapsule( &slot->capsule, &cast );
	}
	else if ( slot->type == b3_hullShape )
	{
		output = b3ShapeCastHull( slot->hull, &cast );
	}
	else if ( slot->type == b3_meshShape )
	{
		output = b3ShapeCastMesh( &mesh, &cast );
	}
	else if ( slot->type == b3_heightShape )
	{
		output = b3ShapeCastHeightField( slot->heightField, &cast );
	}
	else
	{
		output = b3ShapeCastCompound( slot->compound, &cast );
	}
	return writeCastOutput( output, transform );
}

// Only for a slot holding a sphere, capsule, or hull.
static b3ShapeProxy loadSlotProxy( const GeometrySlot* slot )
{
	if ( slot->type == b3_sphereShape )
	{
		return ( b3ShapeProxy ){ &slot->sphere.center, 1, slot->sphere.radius };
	}
	else if ( slot->type == b3_capsuleShape )
	{
		return ( b3ShapeProxy ){ &slot->capsule.center1, 2, slot->capsule.radius };
	}
	return ( b3ShapeProxy ){ b3GetHullPoints( slot->hull ), slot->hull->vertexCount, 0.0f };
}

// Reads slot 0's transform then slot 1's. Writes the closest point on each and the normal from
// slot 0 toward slot 1 in world space, then the distance and the iteration count.
EMSCRIPTEN_KEEPALIVE float* computeGeometryDistance( bool useRadii )
{
	b3Transform transformA = loadInputTransform( input );
	b3Transform transformB = loadInputTransform( (float*)input + 7 );
	b3DistanceInput distanceInput = {
		loadSlotProxy( &geometrySlots[0] ),
		loadSlotProxy( &geometrySlots[1] ),
		b3InvMulTransforms( transformA, transformB ),
		useRadii,
	};
	b3SimplexCache cache = { 0 };
	b3DistanceOutput distance = b3ShapeDistance( &distanceInput, &cache, NULL, 0 );
	float* written = reserveOutput( 11 * sizeof( float ) );
	storeVector( written, b3TransformPoint( transformA, distance.pointA ) );
	storeVector( written + 3, b3TransformPoint( transformA, distance.pointB ) );
	storeVector( written + 6, b3RotateVector( transformA.q, distance.normal ) );
	written[9] = distance.distance;
	written[10] = (float)distance.iterations;
	return written;
}

// Reads a sweep as its local center x, y, z, starting center x, y, z, ending center x, y, z, then
// starting and ending rotations (x, y, z, w each).
static b3Sweep loadSweep( const float* values )
{
	return ( b3Sweep ){
		loadVector( values ),
		loadVector( values + 3 ),
		loadVector( values + 6 ),
		{ loadVector( values + 9 ), values[12] },
		{ loadVector( values + 13 ), values[16] },
	};
}

// Reads slot 0's sweep, slot 1's sweep, then the max fraction. Writes the state, the point x, y, z,
// the normal x, y, z, the fraction, and the distance.
EMSCRIPTEN_KEEPALIVE float* computeTimeOfImpact( void )
{
	float* values = input;
	b3TOIInput toiInput = {
		loadSlotProxy( &geometrySlots[0] ),
		loadSlotProxy( &geometrySlots[1] ),
		loadSweep( values ),
		loadSweep( values + 17 ),
		values[34],
	};
	b3TOIOutput toi = b3TimeOfImpact( &toiInput );
	float* written = reserveOutput( 9 * sizeof( float ) );
	written[0] = (float)toi.state;
	storeVector( written + 1, toi.point );
	storeVector( written + 4, toi.normal );
	written[7] = toi.fraction;
	written[8] = toi.distance;
	return written;
}

#define maxGeometryManifoldPoints 8

static b3LocalManifoldPoint geometryManifoldPoints[maxGeometryManifoldPoints];

// Box3D only collides a sphere, capsule, or hull with one that comes earlier in this order.
static int collisionOrder( b3ShapeType type )
{
	return type == b3_sphereShape ? 0 : type == b3_capsuleShape ? 1 : 2;
}

static void collideOrdered( b3LocalManifold* manifold, const GeometrySlot* slotA, const GeometrySlot* slotB,
							b3Transform transformBtoA )
{
	b3SimplexCache simplexCache = { 0 };
	b3SATCache satCache = { 0 };
	if ( slotA->type == b3_sphereShape )
	{
		b3CollideSpheres( manifold, maxGeometryManifoldPoints, &slotA->sphere, &slotB->sphere, transformBtoA );
	}
	else if ( slotA->type == b3_capsuleShape && slotB->type == b3_sphereShape )
	{
		b3CollideCapsuleAndSphere( manifold, maxGeometryManifoldPoints, &slotA->capsule, &slotB->sphere,
								   transformBtoA );
	}
	else if ( slotA->type == b3_capsuleShape )
	{
		b3CollideCapsules( manifold, maxGeometryManifoldPoints, &slotA->capsule, &slotB->capsule, transformBtoA );
	}
	else if ( slotB->type == b3_sphereShape )
	{
		b3CollideHullAndSphere( manifold, maxGeometryManifoldPoints, slotA->hull, &slotB->sphere, transformBtoA,
								&simplexCache );
	}
	else if ( slotB->type == b3_capsuleShape )
	{
		b3CollideHullAndCapsule( manifold, maxGeometryManifoldPoints, slotA->hull, &slotB->capsule, transformBtoA,
								 &simplexCache );
	}
	else
	{
		b3CollideHulls( manifold, maxGeometryManifoldPoints, slotA->hull, slotB->hull, transformBtoA, &satCache );
	}
}

// Writes the point count and the normal x, y, z, then each point's x, y, z, separation, and feature
// id (as an int32), in world space by `transform`. `isFlipped` reverses the normal.
static float* writeManifold( const b3LocalManifold* manifold, b3Transform transform, bool isFlipped )
{
	float* written = reserveOutput( ( 4 + 5 * manifold->pointCount ) * sizeof( float ) );
	written[0] = (float)manifold->pointCount;
	b3Vec3 normal = b3RotateVector( transform.q, manifold->normal );
	storeVector( written + 1, isFlipped ? b3Neg( normal ) : normal );
	for ( int pointIndex = 0; pointIndex < manifold->pointCount; ++pointIndex )
	{
		const b3LocalManifoldPoint* point = &manifold->points[pointIndex];
		float* values = written + 4 + 5 * pointIndex;
		storeVector( values, b3TransformPoint( transform, point->point ) );
		values[3] = point->separation;
		b3FeaturePair pair = point->pair;
		( (int32_t*)values )[4] = ( pair.owner1 << 24 ) | ( pair.index1 << 16 ) | ( pair.owner2 << 8 ) | pair.index2;
	}
	return written;
}

// Collides the sphere, capsule, or hull in slot 0 with the one in slot 1. Reads slot 0's transform
// then slot 1's. The written normal points from slot 0 toward slot 1.
EMSCRIPTEN_KEEPALIVE float* collideGeometry( void )
{
	const GeometrySlot* slotA = &geometrySlots[0];
	const GeometrySlot* slotB = &geometrySlots[1];
	b3Transform transformA = loadInputTransform( input );
	b3Transform transformB = loadInputTransform( (float*)input + 7 );
	b3LocalManifold manifold = { 0 };
	manifold.points = geometryManifoldPoints;
	bool isSwapped = collisionOrder( slotA->type ) < collisionOrder( slotB->type );
	if ( isSwapped )
	{
		collideOrdered( &manifold, slotB, slotA, b3InvMulTransforms( transformB, transformA ) );
		return writeManifold( &manifold, transformB, true );
	}
	collideOrdered( &manifold, slotA, slotB, b3InvMulTransforms( transformA, transformB ) );
	return writeManifold( &manifold, transformA, false );
}

// Collides the sphere, capsule, or hull in slot 0 with a triangle. Reads slot 0's transform, then
// the triangle's three corners (x, y, z each) in world space. Writes the same way as
// `collideGeometry`.
EMSCRIPTEN_KEEPALIVE float* collideGeometryTriangle( void )
{
	const GeometrySlot* slot = &geometrySlots[0];
	float* values = input;
	b3Transform transform = loadInputTransform( values );
	b3Vec3 triangle[3];
	for ( int cornerIndex = 0; cornerIndex < 3; ++cornerIndex )
	{
		triangle[cornerIndex] = b3InvTransformPoint( transform, loadVector( values + 7 + 3 * cornerIndex ) );
	}
	b3LocalManifold manifold = { 0 };
	manifold.points = geometryManifoldPoints;
	b3SimplexCache simplexCache = { 0 };
	b3SATCache satCache = { 0 };
	if ( slot->type == b3_sphereShape )
	{
		b3CollideSphereAndTriangle( &manifold, maxGeometryManifoldPoints, &slot->sphere, triangle );
	}
	else if ( slot->type == b3_capsuleShape )
	{
		b3CollideCapsuleAndTriangle( &manifold, maxGeometryManifoldPoints, &slot->capsule, triangle, &simplexCache );
	}
	else
	{
		// no flags marks every edge convex, so each edge can make contact points
		b3CollideHullAndTriangle( &manifold, maxGeometryManifoldPoints, slot->hull, triangle[0], triangle[1],
								  triangle[2], 0, &satCache );
	}
	return writeManifold( &manifold, transform, false );
}

// Writes the point count, then the points (x, y, z each), and destroys the hull. A NULL hull writes no
// points.
static float* writeHullPoints( b3HullData* hull )
{
	int pointCount = hull == NULL ? 0 : hull->vertexCount;
	float* written = reserveOutput( ( 1 + 3 * pointCount ) * sizeof( float ) );
	written[0] = (float)pointCount;
	if ( hull != NULL )
	{
		memcpy( written + 1, b3GetHullPoints( hull ), pointCount * sizeof( b3Vec3 ) );
		b3DestroyHull( hull );
	}
	return written;
}

// Reads `pointCount` points (x, y, z each) from the input buffer.
EMSCRIPTEN_KEEPALIVE float* computeHull( int pointCount, int maxVertexCount )
{
	return writeHullPoints( b3CreateHull( input, pointCount, maxVertexCount ) );
}

EMSCRIPTEN_KEEPALIVE float* createCylinderHull( float height, float radius, float yOffset, int sides )
{
	return writeHullPoints( b3CreateCylinder( height, radius, yOffset, sides ) );
}

EMSCRIPTEN_KEEPALIVE float* createConeHull( float height, float radius1, float radius2, int slices )
{
	return writeHullPoints( b3CreateCone( height, radius1, radius2, slices ) );
}

EMSCRIPTEN_KEEPALIVE float* createRockHull( float radius )
{
	return writeHullPoints( b3CreateRock( radius ) );
}

// Writes the vertex count and triangle count, then the vertices (x, y, z each) and each triangle's
// three vertex indices, all as floats, and destroys the mesh.
static float* writeMeshData( b3MeshData* mesh )
{
	int vertexCount = mesh->vertexCount;
	int triangleCount = mesh->triangleCount;
	float* written = reserveOutput( ( 2 + 3 * vertexCount + 3 * triangleCount ) * sizeof( float ) );
	written[0] = (float)vertexCount;
	written[1] = (float)triangleCount;
	memcpy( written + 2, b3GetMeshVertices( mesh ), vertexCount * sizeof( b3Vec3 ) );
	const b3MeshTriangle* triangles = b3GetMeshTriangles( mesh );
	float* indices = written + 2 + 3 * vertexCount;
	for ( int triangleIndex = 0; triangleIndex < triangleCount; ++triangleIndex )
	{
		indices[3 * triangleIndex] = (float)triangles[triangleIndex].index1;
		indices[3 * triangleIndex + 1] = (float)triangles[triangleIndex].index2;
		indices[3 * triangleIndex + 2] = (float)triangles[triangleIndex].index3;
	}
	b3DestroyMesh( mesh );
	return written;
}

EMSCRIPTEN_KEEPALIVE float* createGridMesh( int xCount, int zCount, float cellWidth )
{
	return writeMeshData( b3CreateGridMesh( xCount, zCount, cellWidth, 1, true ) );
}

EMSCRIPTEN_KEEPALIVE float* createWaveMesh( int xCount, int zCount, float cellWidth, float amplitude,
											float rowFrequency, float columnFrequency )
{
	return writeMeshData( b3CreateWaveMesh( xCount, zCount, cellWidth, amplitude, rowFrequency, columnFrequency ) );
}

EMSCRIPTEN_KEEPALIVE float* createTorusMesh( int radialResolution, int tubularResolution, float radius,
											 float thickness )
{
	return writeMeshData( b3CreateTorusMesh( radialResolution, tubularResolution, radius, thickness ) );
}

EMSCRIPTEN_KEEPALIVE float* createBoxMesh( float centerX, float centerY, float centerZ, float extentX, float extentY,
										   float extentZ )
{
	return writeMeshData(
		b3CreateBoxMesh( ( b3Vec3 ){ centerX, centerY, centerZ }, ( b3Vec3 ){ extentX, extentY, extentZ }, true ) );
}

EMSCRIPTEN_KEEPALIVE float* createHollowBoxMesh( float centerX, float centerY, float centerZ, float extentX,
												 float extentY, float extentZ )
{
	return writeMeshData(
		b3CreateHollowBoxMesh( ( b3Vec3 ){ centerX, centerY, centerZ }, ( b3Vec3 ){ extentX, extentY, extentZ } ) );
}

EMSCRIPTEN_KEEPALIVE float* createPlatformMesh( float centerX, float centerY, float centerZ, float height,
												float topWidth, float bottomWidth )
{
	return writeMeshData(
		b3CreatePlatformMesh( ( b3Vec3 ){ centerX, centerY, centerZ }, height, topWidth, bottomWidth ) );
}

// Writes the row count, column count, minimum height, and maximum height, then the heights (x
// varying fastest), then 1 for each cell that's a hole and 0 for the rest (x varying fastest), and
// destroys the height field.
static float* writeHeightFieldData( b3HeightFieldData* heightField )
{
	int rowCount = heightField->rowCount;
	int columnCount = heightField->columnCount;
	int heightCount = rowCount * columnCount;
	int cellCount = ( rowCount - 1 ) * ( columnCount - 1 );
	float* written = reserveOutput( ( 4 + heightCount + cellCount ) * sizeof( float ) );
	written[0] = (float)rowCount;
	written[1] = (float)columnCount;
	written[2] = heightField->minHeight;
	written[3] = heightField->maxHeight;
	const uint16_t* compressedHeights = b3GetHeightFieldCompressedHeights( heightField );
	for ( int heightIndex = 0; heightIndex < heightCount; ++heightIndex )
	{
		written[4 + heightIndex] = heightField->minHeight + heightField->heightScale * compressedHeights[heightIndex];
	}
	const uint8_t* materialIndices = b3GetHeightFieldMaterialIndices( heightField );
	for ( int cellIndex = 0; cellIndex < cellCount; ++cellIndex )
	{
		written[4 + heightCount + cellIndex] = materialIndices[cellIndex] == B3_HEIGHT_FIELD_HOLE;
	}
	b3DestroyHeightField( heightField );
	return written;
}

EMSCRIPTEN_KEEPALIVE float* createGridHeightField( int rowCount, int columnCount, float scaleX, float scaleY,
												   float scaleZ, bool makeHoles )
{
	return writeHeightFieldData(
		b3CreateGrid( rowCount, columnCount, ( b3Vec3 ){ scaleX, scaleY, scaleZ }, makeHoles ) );
}

EMSCRIPTEN_KEEPALIVE float* createWaveHeightField( int rowCount, int columnCount, float scaleX, float scaleY,
												   float scaleZ, float rowFrequency, float columnFrequency,
												   bool makeHoles )
{
	return writeHeightFieldData( b3CreateWave( rowCount, columnCount, ( b3Vec3 ){ scaleX, scaleY, scaleZ },
											   rowFrequency, columnFrequency, makeHoles ) );
}

typedef struct TriangleQuery
{
	b3Transform transform;
	FloatList found;
} TriangleQuery;

static bool collectTriangle( b3Vec3 a, b3Vec3 b, b3Vec3 c, int triangleIndex, void* context )
{
	TriangleQuery* query = context;
	float index = (float)triangleIndex;
	pushFloats( &query->found, &index, 1 );
	pushVector( &query->found, b3TransformPoint( query->transform, a ) );
	pushVector( &query->found, b3TransformPoint( query->transform, b ) );
	pushVector( &query->found, b3TransformPoint( query->transform, c ) );
	return true;
}

// Reads slot 0's transform, then world bounds as `writeBounds` writes them. Writes the count, then
// each triangle's index and three corners (x, y, z each) in world space, for the triangles of slot
// 0's mesh or height field that may overlap the bounds.
EMSCRIPTEN_KEEPALIVE float* queryGeometryTriangles( void )
{
	const GeometrySlot* slot = &geometrySlots[0];
	float* values = input;
	TriangleQuery query = { loadInputTransform( values ), { 0 } };
	b3AABB bounds = b3AABB_Transform( b3InvertTransform( query.transform ),
									  ( b3AABB ){ loadVector( values + 7 ), loadVector( values + 10 ) } );
	if ( slot->type == b3_meshShape )
	{
		b3Mesh mesh = { slot->mesh, b3Vec3_one };
		b3QueryMesh( &mesh, bounds, collectTriangle, &query );
	}
	else
	{
		b3QueryHeightField( slot->heightField, bounds, collectTriangle, &query );
	}
	int triangleCount = query.found.count / 10;
	float* written = reserveOutput( ( 1 + query.found.count ) * sizeof( float ) );
	written[0] = (float)triangleCount;
	memcpy( written + 1, query.found.values, query.found.count * sizeof( float ) );
	free( query.found.values );
	return written;
}

static int32_t* foundIds = NULL;
static int foundIdCount = 0;
static int foundIdCapacity = 0;

static void findId( int id )
{
	if ( foundIdCount == foundIdCapacity )
	{
		foundIdCapacity = foundIdCapacity == 0 ? 16 : foundIdCapacity * 2;
		foundIds = realloc( foundIds, foundIdCapacity * sizeof( int32_t ) );
	}
	foundIds[foundIdCount++] = id;
}

// Writes the found id count, then the ids.
static int32_t* writeFoundIds( void )
{
	int32_t* written = reserveOutput( ( 1 + foundIdCount ) * sizeof( int32_t ) );
	written[0] = foundIdCount;
	memcpy( written + 1, foundIds, foundIdCount * sizeof( int32_t ) );
	foundIdCount = 0;
	return written;
}

static bool findCompoundChild( const b3CompoundData* compound, int childIndex, void* context )
{
	findId( childIndex );
	return true;
}

// Reads the same input as `queryGeometryTriangles`. Writes the indexes of slot 0's compound children
// that may overlap the bounds, as `writeFoundIds` writes them.
EMSCRIPTEN_KEEPALIVE int32_t* queryGeometryChildren( void )
{
	float* values = input;
	b3Transform transform = loadInputTransform( values );
	b3AABB bounds = b3AABB_Transform( b3InvertTransform( transform ),
									  ( b3AABB ){ loadVector( values + 7 ), loadVector( values + 10 ) } );
	b3QueryCompound( geometrySlots[0].compound, bounds, findCompoundChild, NULL );
	return writeFoundIds();
}

EMSCRIPTEN_KEEPALIVE b3DynamicTree* createTree( void )
{
	b3DynamicTree* tree = malloc( sizeof( b3DynamicTree ) );
	*tree = b3DynamicTree_Create( 16 );
	return tree;
}

EMSCRIPTEN_KEEPALIVE void destroyTree( b3DynamicTree* tree )
{
	b3DynamicTree_Destroy( tree );
	free( tree );
}

static b3AABB makeBox( float lowerX, float lowerY, float lowerZ, float upperX, float upperY, float upperZ )
{
	return ( b3AABB ){ { lowerX, lowerY, lowerZ }, { upperX, upperY, upperZ } };
}

EMSCRIPTEN_KEEPALIVE int createTreeProxy( b3DynamicTree* tree, float lowerX, float lowerY, float lowerZ, float upperX,
										  float upperY, float upperZ, uint64_t category )
{
	return b3DynamicTree_CreateProxy( tree, makeBox( lowerX, lowerY, lowerZ, upperX, upperY, upperZ ), category, 0 );
}

EMSCRIPTEN_KEEPALIVE void destroyTreeProxy( b3DynamicTree* tree, int proxyId )
{
	b3DynamicTree_DestroyProxy( tree, proxyId );
}

// `isEnlarged` grows the proxy's bounds to include the new ones, which is cheaper than moving it.
EMSCRIPTEN_KEEPALIVE void moveTreeProxy( b3DynamicTree* tree, int proxyId, float lowerX, float lowerY, float lowerZ,
										 float upperX, float upperY, float upperZ, bool isEnlarged )
{
	b3AABB bounds = makeBox( lowerX, lowerY, lowerZ, upperX, upperY, upperZ );
	if ( isEnlarged )
	{
		b3DynamicTree_EnlargeProxy( tree, proxyId, bounds );
	}
	else
	{
		b3DynamicTree_MoveProxy( tree, proxyId, bounds );
	}
}

EMSCRIPTEN_KEEPALIVE void setTreeProxyCategory( b3DynamicTree* tree, int proxyId, uint64_t category )
{
	b3DynamicTree_SetCategoryBits( tree, proxyId, category );
}

EMSCRIPTEN_KEEPALIVE uint64_t getTreeProxyCategory( b3DynamicTree* tree, int proxyId )
{
	return b3DynamicTree_GetCategoryBits( tree, proxyId );
}

EMSCRIPTEN_KEEPALIVE float* readTreeProxyBounds( b3DynamicTree* tree, int proxyId )
{
	return writeBounds( b3DynamicTree_GetAABB( tree, proxyId ) );
}

EMSCRIPTEN_KEEPALIVE int rebuildTree( b3DynamicTree* tree, bool isFullBuild )
{
	return b3DynamicTree_Rebuild( tree, isFullBuild );
}

// Writes the height, area ratio, proxy count, and byte count, then the root bounds.
EMSCRIPTEN_KEEPALIVE float* readTreeStats( b3DynamicTree* tree )
{
	b3AABB root = b3DynamicTree_GetRootBounds( tree );
	float* written = reserveOutput( 10 * sizeof( float ) );
	written[0] = (float)b3DynamicTree_GetHeight( tree );
	written[1] = b3DynamicTree_GetAreaRatio( tree );
	written[2] = (float)b3DynamicTree_GetProxyCount( tree );
	written[3] = (float)b3DynamicTree_GetByteCount( tree );
	storeVector( written + 4, root.lowerBound );
	storeVector( written + 7, root.upperBound );
	return written;
}

static bool findOverlappingProxy( int proxyId, uint64_t userData, void* context )
{
	findId( proxyId );
	return true;
}

// Returning the input's own max fraction keeps the cast going without clipping it.
static float findRayProxy( const b3RayCastInput* rayInput, int proxyId, uint64_t userData, void* context )
{
	findId( proxyId );
	return rayInput->maxFraction;
}

static float findBoxProxy( const b3BoxCastInput* boxInput, int proxyId, uint64_t userData, void* context )
{
	findId( proxyId );
	return boxInput->maxFraction;
}

EMSCRIPTEN_KEEPALIVE int32_t* queryTree( b3DynamicTree* tree, float lowerX, float lowerY, float lowerZ, float upperX,
										 float upperY, float upperZ, uint64_t mask, bool requireAllBits )
{
	b3DynamicTree_Query( tree, makeBox( lowerX, lowerY, lowerZ, upperX, upperY, upperZ ), mask, requireAllBits,
						 findOverlappingProxy, NULL );
	return writeFoundIds();
}

EMSCRIPTEN_KEEPALIVE int32_t* castTreeRay( b3DynamicTree* tree, float originX, float originY, float originZ,
										   float translationX, float translationY, float translationZ,
										   float maxFraction, uint64_t mask, bool requireAllBits )
{
	b3RayCastInput ray = {
		{ originX, originY, originZ },
		{ translationX, translationY, translationZ },
		maxFraction,
	};
	b3DynamicTree_RayCast( tree, &ray, mask, requireAllBits, findRayProxy, NULL );
	return writeFoundIds();
}

// Reads the box as `writeBounds` writes it, then the translation x, y, z and max fraction.
EMSCRIPTEN_KEEPALIVE int32_t* castTreeBox( b3DynamicTree* tree, uint64_t mask, bool requireAllBits )
{
	float* values = input;
	b3BoxCastInput box = {
		{ loadVector( values ), loadVector( values + 3 ) },
		loadVector( values + 6 ),
		values[9],
	};
	b3DynamicTree_BoxCast( tree, &box, mask, requireAllBits, findBoxProxy, NULL );
	return writeFoundIds();
}

typedef struct ClosestProxy
{
	const b3DynamicTree* tree;
	b3Vec3 point;
	int proxyId;
	float distanceSquared;
} ClosestProxy;

static float findClosestProxy( float distanceSquaredMin, int proxyId, uint64_t userData, void* context )
{
	ClosestProxy* closest = context;
	b3AABB bounds = b3DynamicTree_GetAABB( closest->tree, proxyId );
	float distanceSquared = b3DistanceSquared( closest->point, b3ClosestPointToAABB( closest->point, bounds ) );
	if ( distanceSquared < closest->distanceSquared )
	{
		closest->proxyId = proxyId;
		closest->distanceSquared = distanceSquared;
	}
	return closest->distanceSquared;
}

// Writes the id of the proxy whose bounds are closest to the point, or -1 when none are within
// `maxDistance`, then the distance to its bounds.
EMSCRIPTEN_KEEPALIVE float* queryTreeClosest( b3DynamicTree* tree, float x, float y, float z, float maxDistance,
											  uint64_t mask, bool requireAllBits )
{
	ClosestProxy closest = { tree, { x, y, z }, -1, maxDistance * maxDistance };
	float distanceSquared = closest.distanceSquared;
	b3DynamicTree_QueryClosest( tree, closest.point, mask, requireAllBits, findClosestProxy, &closest,
								&distanceSquared );
	float* written = reserveOutput( 2 * sizeof( float ) );
	written[0] = (float)closest.proxyId;
	written[1] = sqrtf( closest.distanceSquared );
	return written;
}
