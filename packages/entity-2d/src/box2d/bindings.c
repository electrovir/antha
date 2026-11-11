// The only functions JavaScript calls. Every input and output is a plain number, because wasm can't
// pass structs to JavaScript. Results bigger than one number go into `output`, which JavaScript
// reads straight out of wasm memory.
#include <emscripten/em_js.h>
#include <emscripten/emscripten.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "box2d/box2d.h"

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

static b2BodyId loadBodyId( int32_t index, int32_t tag )
{
	return b2LoadBodyId( loadId( index, tag ) );
}

static b2JointId loadJointId( int32_t index, int32_t tag )
{
	return b2LoadJointId( loadId( index, tag ) );
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

// JavaScript writes array inputs (polygon and chain points) here before calling the function that
// reads them.
EMSCRIPTEN_KEEPALIVE void* reserveInput( int byteCount )
{
	if ( byteCount > inputCapacity )
	{
		inputCapacity = byteCount * 2;
		input = realloc( input, inputCapacity );
	}
	return input;
}

EMSCRIPTEN_KEEPALIVE void setLengthUnitsPerMeter( float lengthUnits )
{
	b2SetLengthUnitsPerMeter( lengthUnits );
}

// What Box2D's shapes don't store for us. Shapes with a one-way direction (in their body's frame) only
// collide with things on the side it points to.
typedef struct TrackedShape
{
	uint16_t generation;
	bool isOneWay;
	bool enablePreSolve;
	b2Vec2 direction;
} TrackedShape;

// A one-way shape and a shape that touched it from the wrong side. They don't collide until they
// stop touching, so that a body passing through doesn't get pushed out the far side once it's
// mostly through.
typedef struct PassingPair
{
	b2ShapeId oneWayShape;
	b2ShapeId otherShape;
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
	b2Recording* recording;
} TrackedWorld;

static TrackedWorld trackedWorlds[B2_MAX_WORLDS];

static const TrackedShape* findShape( b2ShapeId shapeId )
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

static const TrackedShape* findOneWayShape( b2ShapeId shapeId )
{
	const TrackedShape* shape = findShape( shapeId );
	return shape && shape->isOneWay ? shape : NULL;
}

static bool allowsOneWayContact( b2ShapeId shapeIdA, b2ShapeId shapeIdB, b2Vec2 normal )
{
	const TrackedShape* oneWayA = findOneWayShape( shapeIdA );
	const TrackedShape* oneWayB = findOneWayShape( shapeIdB );
	if ( !oneWayA && !oneWayB )
	{
		return true;
	}
	b2ShapeId oneWayShape = oneWayA ? shapeIdA : shapeIdB;
	b2ShapeId otherShape = oneWayA ? shapeIdB : shapeIdA;
	// the normal points from shape A to shape B, so this points from the one-way shape to the other
	b2Vec2 towardOther = oneWayA ? normal : b2Neg( normal );
	TrackedWorld* world = trackedWorlds + shapeIdA.world0;
	for ( int index = 0; index < world->passingCount; ++index )
	{
		PassingPair* pair = world->passingPairs + index;
		if ( B2_ID_EQUALS( pair->oneWayShape, oneWayShape ) && B2_ID_EQUALS( pair->otherShape, otherShape ) )
		{
			pair->isTouching = true;
			return false;
		}
	}
	b2Rot rotation = b2Body_GetRotation( b2Shape_GetBody( oneWayShape ) );
	b2Vec2 direction = b2RotateVector( rotation, ( oneWayA ? oneWayA : oneWayB )->direction );
	if ( b2Dot( towardOther, direction ) > 0.0f )
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

static int32_t shapeEntity( b2ShapeId shapeId )
{
	return (int32_t)(intptr_t)b2Shape_GetUserData( shapeId );
}

// `anthaWorldHooks` on the module maps each world id to a function that returns the world's current
// hooks. Box2D only calls these for hooks that `setHooks` turned on.
EM_JS( bool, callCustomFilter, ( uint32_t world, int32_t entityA, int32_t entityB ), {
	return Module.anthaWorldHooks.get( world )().customFilter( { entityA, entityB } );
} );

EM_JS( bool, callPreSolve,
	   ( uint32_t world, int32_t entityA, int32_t entityB, float pointX, float pointY, float normalX, float normalY ), {
		   return Module.anthaWorldHooks.get( world )().preSolve(
			   { entityA, entityB, point : { x : pointX, y : pointY }, normal : { x : normalX, y : normalY } } );
	   } );

EM_JS( float, callMixFriction, ( uint32_t world, float frictionA, int32_t idA, float frictionB, int32_t idB ), {
	return Module.anthaWorldHooks.get( world )().mixFriction( { value : frictionA, userMaterialId : idA },
															   { value : frictionB, userMaterialId : idB } );
} );

EM_JS( float, callMixRestitution,
	   ( uint32_t world, float restitutionA, int32_t idA, float restitutionB, int32_t idB ), {
		   return Module.anthaWorldHooks.get( world )().mixRestitution(
			   { value : restitutionA, userMaterialId : idA }, { value : restitutionB, userMaterialId : idB } );
	   } );

static bool allowsContact( uint32_t world, b2ShapeId shapeIdA, b2ShapeId shapeIdB, b2Pos point, b2Vec2 normal )
{
	if ( !allowsOneWayContact( shapeIdA, shapeIdB, normal ) )
	{
		return false;
	}
	if ( !trackedWorlds[shapeIdA.world0].hasPreSolveHook )
	{
		return true;
	}
	// chain segments aren't tracked
	const TrackedShape* shapeA = findShape( shapeIdA );
	const TrackedShape* shapeB = findShape( shapeIdB );
	if ( !( shapeA && shapeA->enablePreSolve ) && !( shapeB && shapeB->enablePreSolve ) )
	{
		return true;
	}
	return callPreSolve( world, shapeEntity( shapeIdA ), shapeEntity( shapeIdB ), point.x, point.y, normal.x,
						 normal.y );
}

// `context` is the world id, here and in the other world callbacks.
static void preSolve( b2ShapeId shapeIdA, b2ShapeId shapeIdB, b2Manifold* manifold, void* context )
{
	b2Pos point = b2OffsetPos( b2Body_GetWorldCenter( b2Shape_GetBody( shapeIdA ) ), manifold->points[0].anchorA );
	if ( !allowsContact( (uint32_t)(uintptr_t)context, shapeIdA, shapeIdB, point, manifold->normal ) )
	{
		manifold->pointCount = 0;
	}
}

static bool preContinuous( b2ShapeId shapeIdA, b2ShapeId shapeIdB, b2Pos point, b2Vec2 normal, void* context )
{
	return allowsContact( (uint32_t)(uintptr_t)context, shapeIdA, shapeIdB, point, normal );
}

static bool customFilter( b2ShapeId shapeIdA, b2ShapeId shapeIdB, void* context )
{
	return callCustomFilter( (uint32_t)(uintptr_t)context, shapeEntity( shapeIdA ), shapeEntity( shapeIdB ) );
}

// Box2D only mixes materials inside `b2World_Step`, and doesn't pass the mixers a context.
static uint32_t steppingWorld;

static float mixFriction( float frictionA, uint64_t userMaterialIdA, float frictionB, uint64_t userMaterialIdB )
{
	return callMixFriction( steppingWorld, frictionA, (int32_t)userMaterialIdA, frictionB, (int32_t)userMaterialIdB );
}

static float mixRestitution( float restitutionA, uint64_t userMaterialIdA, float restitutionB,
							 uint64_t userMaterialIdB )
{
	return callMixRestitution( steppingWorld, restitutionA, (int32_t)userMaterialIdA, restitutionB,
							   (int32_t)userMaterialIdB );
}

// Drops the passing pairs that no pre-solve call saw since the last call to this, since their shapes
// stopped touching. Box2D runs pre-solve every step for contacts it disabled.
static void forgetSeparatedPairs( b2WorldId worldId )
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

EMSCRIPTEN_KEEPALIVE uint32_t createWorld( float gravityX, float gravityY )
{
	b2WorldDef def = b2DefaultWorldDef();
	def.gravity = ( b2Vec2 ){ gravityX, gravityY };
	b2WorldId worldId = b2CreateWorld( &def );
	uint32_t world = b2StoreWorldId( worldId );
	b2World_SetPreSolveCallback( worldId, preSolve, preContinuous, (void*)(uintptr_t)world );
	return world;
}

// Turns the JavaScript hooks of the world on or off.
EMSCRIPTEN_KEEPALIVE void setHooks( uint32_t world, bool enableCustomFilter, bool enablePreSolve,
									bool enableMixFriction, bool enableMixRestitution )
{
	b2WorldId worldId = b2LoadWorldId( world );
	b2World_SetCustomFilterCallback( worldId, enableCustomFilter ? customFilter : NULL, (void*)(uintptr_t)world );
	trackedWorlds[worldId.index1 - 1].hasPreSolveHook = enablePreSolve;
	trackedWorlds[worldId.index1 - 1].hasOtherHooks = enableCustomFilter || enableMixFriction || enableMixRestitution;
	b2World_SetFrictionCallback( worldId, enableMixFriction ? mixFriction : NULL );
	b2World_SetRestitutionCallback( worldId, enableMixRestitution ? mixRestitution : NULL );
}

EMSCRIPTEN_KEEPALIVE void destroyWorld( uint32_t world )
{
	b2WorldId worldId = b2LoadWorldId( world );
	TrackedWorld* trackedWorld = trackedWorlds + worldId.index1 - 1;
	free( trackedWorld->shapes );
	free( trackedWorld->passingPairs );
	b2Recording* recording = trackedWorld->recording;
	*trackedWorld = ( TrackedWorld ){ 0 };
	b2DestroyWorld( worldId );
	b2DestroyRecording( recording );
}

EMSCRIPTEN_KEEPALIVE void setGravity( uint32_t world, float x, float y )
{
	b2World_SetGravity( b2LoadWorldId( world ), ( b2Vec2 ){ x, y } );
}

EMSCRIPTEN_KEEPALIVE uint64_t getStateHash( uint32_t world )
{
	return b2World_GetStateHash( b2LoadWorldId( world ) );
}

// Writes six counts (contact begin, contact end, sensor begin, sensor end, hit, strained joint), then
// the entity id pair of each contact begin, contact end, sensor begin, and sensor end event (sensor
// first), then each hit as its entity id pair followed by point x, y, normal x, y (from the first
// entity toward the second), and approach speed as floats, then the id JavaScript gave each joint
// that passed its force or torque threshold.
EMSCRIPTEN_KEEPALIVE int32_t* step( uint32_t world, float seconds, int subSteps )
{
	b2WorldId worldId = b2LoadWorldId( world );
	steppingWorld = world;
	b2World_Step( worldId, seconds, subSteps );
	forgetSeparatedPairs( worldId );
	b2ContactEvents contacts = b2World_GetContactEvents( worldId );
	b2SensorEvents sensors = b2World_GetSensorEvents( worldId );
	b2JointEvents joints = b2World_GetJointEvents( worldId );
	int pairCapacity = contacts.beginCount + contacts.endCount + sensors.beginCount + sensors.endCount;
	int32_t* written =
		reserveOutput( ( 6 + 2 * pairCapacity + 7 * contacts.hitCount + joints.count ) * sizeof( int32_t ) );
	int32_t* next = written + 6;
	for ( int index = 0; index < contacts.beginCount; ++index )
	{
		*next++ = shapeEntity( contacts.beginEvents[index].shapeIdA );
		*next++ = shapeEntity( contacts.beginEvents[index].shapeIdB );
	}
	int contactEndCount = 0;
	for ( int index = 0; index < contacts.endCount; ++index )
	{
		b2ShapeId shapeA = contacts.endEvents[index].shapeIdA;
		b2ShapeId shapeB = contacts.endEvents[index].shapeIdB;
		// end events also fire for shapes destroyed since the last step
		if ( b2Shape_IsValid( shapeA ) && b2Shape_IsValid( shapeB ) )
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
		b2ShapeId sensorShape = sensors.endEvents[index].sensorShapeId;
		b2ShapeId visitorShape = sensors.endEvents[index].visitorShapeId;
		if ( b2Shape_IsValid( sensorShape ) && b2Shape_IsValid( visitorShape ) )
		{
			*next++ = shapeEntity( sensorShape );
			*next++ = shapeEntity( visitorShape );
			++sensorEndCount;
		}
	}
	int hitCount = 0;
	for ( int index = 0; index < contacts.hitCount; ++index )
	{
		b2ContactHitEvent* hit = contacts.hitEvents + index;
		if ( !b2Shape_IsValid( hit->shapeIdA ) || !b2Shape_IsValid( hit->shapeIdB ) )
		{
			continue;
		}
		*next++ = shapeEntity( hit->shapeIdA );
		*next++ = shapeEntity( hit->shapeIdB );
		float* numbers = (float*)next;
		numbers[0] = hit->point.x;
		numbers[1] = hit->point.y;
		numbers[2] = hit->normal.x;
		numbers[3] = hit->normal.y;
		numbers[4] = hit->approachSpeed;
		next += 5;
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
	b2World_SetHitEventThreshold( b2LoadWorldId( world ), speed );
}

// Settings are in `worldSettingsTemplate`'s order in physics.ts, with booleans inverted where the
// template names them for being disabled.
EMSCRIPTEN_KEEPALIVE float* readDefaultWorldSettings( void )
{
	b2WorldDef def = b2DefaultWorldDef();
	float* settings = reserveOutput( 11 * sizeof( float ) );
	settings[0] = def.restitutionThreshold;
	settings[1] = (float)def.restitutionIterations;
	settings[2] = def.enableRestitutionPropagation;
	settings[3] = def.contactHertz;
	settings[4] = def.contactDampingRatio;
	settings[5] = def.contactSpeed;
	settings[6] = def.maximumLinearSpeed;
	settings[7] = B2_CONTACT_RECYCLE_DISTANCE;
	settings[8] = !def.enableSleep;
	settings[9] = !def.enableContinuous;
	settings[10] = 0;
	return settings;
}

EMSCRIPTEN_KEEPALIVE void setWorldSettings( uint32_t world )
{
	b2WorldId worldId = b2LoadWorldId( world );
	float* settings = input;
	b2World_SetRestitutionThreshold( worldId, settings[0] );
	b2World_SetRestitutionIterations( worldId, (int)settings[1] );
	b2World_EnableRestitutionPropagation( worldId, settings[2] != 0 );
	b2World_SetContactTuning( worldId, settings[3], settings[4], settings[5] );
	b2World_SetMaxLinearSpeed( worldId, settings[6] );
	b2World_SetContactRecycleDistance( worldId, settings[7] );
	b2World_EnableSleeping( worldId, settings[8] == 0 );
	b2World_EnableContinuous( worldId, settings[9] == 0 );
	b2World_EnableWarmStarting( worldId, settings[10] == 0 );
}

// Motion locks cross as bits: linear x, linear y, then angular, from the lowest bit up.
static b2MotionLocks loadMotionLocks( int bits )
{
	return ( b2MotionLocks ){ bits & 1, bits & 2, bits & 4 };
}

// Writes the cosine and sine Box2D stores for the angle, which are not exactly `Math.cos` and
// `Math.sin`.
EMSCRIPTEN_KEEPALIVE float* makeRotation( float angle )
{
	b2Rot rotation = b2MakeRot( angle );
	float* written = reserveOutput( 2 * sizeof( float ) );
	written[0] = rotation.c;
	written[1] = rotation.s;
	return written;
}

// Writes the new body's id as two numbers.
EMSCRIPTEN_KEEPALIVE int32_t* createBody( uint32_t world, int type, float x, float y, float cosine, float sine,
										 float velocityX, float velocityY, float angularVelocity, float linearDamping,
										 float angularDamping, float gravityScale, int motionLocks, bool isBullet,
										 bool isEnabled, bool enableSleep, float sleepThreshold, int32_t entityId )
{
	b2BodyDef def = b2DefaultBodyDef();
	if ( !isnan( sleepThreshold ) )
	{
		def.sleepThreshold = sleepThreshold;
	}
	def.type = (b2BodyType)type;
	def.position = ( b2Vec2 ){ x, y };
	def.rotation = ( b2Rot ){ cosine, sine };
	def.linearVelocity = ( b2Vec2 ){ velocityX, velocityY };
	def.angularVelocity = angularVelocity;
	def.linearDamping = linearDamping;
	def.angularDamping = angularDamping;
	def.gravityScale = gravityScale;
	def.motionLocks = loadMotionLocks( motionLocks );
	def.isBullet = isBullet;
	def.isEnabled = isEnabled;
	def.enableSleep = enableSleep;
	def.userData = (void*)(intptr_t)entityId;
	return writeId( b2StoreBodyId( b2CreateBody( b2LoadWorldId( world ), &def ) ) );
}

EMSCRIPTEN_KEEPALIVE void destroyBody( int32_t index, int32_t tag )
{
	b2BodyId bodyId = loadBodyId( index, tag );
	if ( b2Body_IsValid( bodyId ) )
	{
		b2DestroyBody( bodyId );
	}
}

static b2ShapeDef shapeDef;
static TrackedShape trackedShape;

// Sets up the shape definition the next `add*` calls use. NaN keeps Box2D's default for a material
// value, -1 keeps it for `userMaterialId`, and a NaN one-way direction makes shapes collide from
// every side.
EMSCRIPTEN_KEEPALIVE void setShapeDefinition( uint64_t category, uint64_t mask, int32_t groupIndex, int32_t entityId,
											  float density, float friction, float restitution,
											  float rollingResistance, float tangentSpeed, int32_t userMaterialId,
											  bool isSensor, bool enableHitEvents, bool enableCustomFiltering,
											  bool enablePreSolve, float oneWayX, float oneWayY )
{
	shapeDef = b2DefaultShapeDef();
	trackedShape = ( TrackedShape ){ 0, !isnan( oneWayX ), enablePreSolve, { oneWayX, oneWayY } };
	shapeDef.enablePreSolveEvents = trackedShape.isOneWay || enablePreSolve;
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
	if ( !isnan( friction ) )
	{
		shapeDef.material.friction = friction;
	}
	if ( !isnan( restitution ) )
	{
		shapeDef.material.restitution = restitution;
	}
	if ( !isnan( rollingResistance ) )
	{
		shapeDef.material.rollingResistance = rollingResistance;
	}
	if ( !isnan( tangentSpeed ) )
	{
		shapeDef.material.tangentSpeed = tangentSpeed;
	}
	if ( userMaterialId >= 0 )
	{
		shapeDef.material.userMaterialId = userMaterialId;
	}
}

// Saves what the last `setShapeDefinition` call set for a new shape that Box2D doesn't store. Every
// shape overwrites its slot, since Box2D reuses the slots of destroyed shapes.
static void recordShape( b2ShapeId shapeId )
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
}

EMSCRIPTEN_KEEPALIVE void addCircle( int32_t index, int32_t tag, float centerX, float centerY, float radius )
{
	b2Circle circle = { { centerX, centerY }, radius };
	recordShape( b2CreateCircleShape( loadBodyId( index, tag ), &shapeDef, &circle ) );
}

EMSCRIPTEN_KEEPALIVE void addCapsule( int32_t index, int32_t tag, float center1X, float center1Y, float center2X,
									  float center2Y, float radius )
{
	b2Capsule capsule = { { center1X, center1Y }, { center2X, center2Y }, radius };
	recordShape( b2CreateCapsuleShape( loadBodyId( index, tag ), &shapeDef, &capsule ) );
}

EMSCRIPTEN_KEEPALIVE void addSegment( int32_t index, int32_t tag, float point1X, float point1Y, float point2X,
									  float point2Y )
{
	b2Segment segment = { { point1X, point1Y }, { point2X, point2Y } };
	recordShape( b2CreateSegmentShape( loadBodyId( index, tag ), &shapeDef, &segment ) );
}

// `radius` rounds the corners and grows the box by that much on every side.
EMSCRIPTEN_KEEPALIVE void addBox( int32_t index, int32_t tag, float centerX, float centerY, float halfWidth,
								  float halfHeight, float radius )
{
	b2Polygon box = b2MakeOffsetRoundedBox( halfWidth, halfHeight, ( b2Vec2 ){ centerX, centerY }, b2Rot_identity,
											radius );
	recordShape( b2CreatePolygonShape( loadBodyId( index, tag ), &shapeDef, &box ) );
}

// Reads `pointCount` points (x, y each) from the input buffer. Returns false when they don't form a
// convex polygon Box2D accepts, such as when there are too many or they all lie on one line.
EMSCRIPTEN_KEEPALIVE bool addPolygon( int32_t index, int32_t tag, int pointCount, float radius )
{
	b2Hull hull = b2ComputeHull( input, pointCount );
	if ( hull.count == 0 )
	{
		return false;
	}
	b2Polygon polygon = b2MakePolygon( &hull, radius );
	recordShape( b2CreatePolygonShape( loadBodyId( index, tag ), &shapeDef, &polygon ) );
	return true;
}

// Reads `pointCount` points (x, y each) from the input buffer, then `materialCount` segment materials
// (friction, restitution, rolling resistance, tangent speed each, NaN for the shape definition's
// value), then an int32 `userMaterialId` for each segment (-1 for the shape definition's). Uses the filter, entity id, and material from the last `setShapeDefinition` call when
// `materialCount` is 0.
EMSCRIPTEN_KEEPALIVE void addChain( int32_t index, int32_t tag, int pointCount, bool isLoop, int materialCount )
{
	b2ChainDef def = b2DefaultChainDef();
	def.points = input;
	def.pointCount = pointCount;
	def.isLoop = isLoop;
	// open chains need ghost points past each end; continuing each end segment straight keeps
	// shapes from catching on the ends
	b2Vec2* points = input;
	def.ghost1 = b2MulSub( points[0], 1.0f, b2Sub( points[1], points[0] ) );
	def.ghost2 = b2MulAdd( points[pointCount - 1], 1.0f, b2Sub( points[pointCount - 1], points[pointCount - 2] ) );
	def.filter = shapeDef.filter;
	def.userData = shapeDef.userData;
	def.enableSensorEvents = shapeDef.enableSensorEvents;
	b2SurfaceMaterial* materials = NULL;
	if ( materialCount == 0 )
	{
		def.materials = &shapeDef.material;
	}
	else
	{
		materials = malloc( materialCount * sizeof( b2SurfaceMaterial ) );
		float* values = (float*)input + 2 * pointCount;
		int32_t* userMaterialIds = (int32_t*)( values + 4 * materialCount );
		for ( int materialIndex = 0; materialIndex < materialCount; ++materialIndex )
		{
			float* value = values + 4 * materialIndex;
			b2SurfaceMaterial material = shapeDef.material;
			material.friction = isnan( value[0] ) ? material.friction : value[0];
			material.restitution = isnan( value[1] ) ? material.restitution : value[1];
			material.rollingResistance = isnan( value[2] ) ? material.rollingResistance : value[2];
			material.tangentSpeed = isnan( value[3] ) ? material.tangentSpeed : value[3];
			if ( userMaterialIds[materialIndex] >= 0 )
			{
				material.userMaterialId = userMaterialIds[materialIndex];
			}
			materials[materialIndex] = material;
		}
		def.materials = materials;
		def.materialCount = materialCount;
	}
	b2CreateChain( loadBodyId( index, tag ), &def );
	free( materials );
}

// Destroys every shape on the body, including chains.
EMSCRIPTEN_KEEPALIVE void removeShapes( int32_t index, int32_t tag )
{
	b2BodyId bodyId = loadBodyId( index, tag );
	int shapeCount = b2Body_GetShapeCount( bodyId );
	b2ShapeId* shapeIds = malloc( shapeCount * sizeof( b2ShapeId ) );
	b2Body_GetShapes( bodyId, shapeIds, shapeCount );
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		// destroying a chain also destroys the rest of its segments in this list
		if ( !b2Shape_IsValid( shapeIds[shapeIndex] ) )
		{
			continue;
		}
		// a chain's segments can't be destroyed one at a time
		b2ChainId chainId = b2Shape_GetParentChain( shapeIds[shapeIndex] );
		if ( B2_IS_NON_NULL( chainId ) )
		{
			b2DestroyChain( chainId );
		}
		else
		{
			b2DestroyShape( shapeIds[shapeIndex], false );
		}
	}
	free( shapeIds );
	b2Body_UpdateMassFromShapes( bodyId );
}

EMSCRIPTEN_KEEPALIVE void setSleepEnabled( int32_t index, int32_t tag, bool isEnabled )
{
	b2Body_EnableSleeping( loadBodyId( index, tag ), isEnabled );
}

// Writes x, y, cosine, sine, angle, velocity x, velocity y, and angular velocity.
EMSCRIPTEN_KEEPALIVE float* readBody( int32_t index, int32_t tag )
{
	b2BodyId bodyId = loadBodyId( index, tag );
	b2Transform transform = b2Body_GetTransform( bodyId );
	b2Vec2 velocity = b2Body_GetLinearVelocity( bodyId );
	float* written = reserveOutput( 8 * sizeof( float ) );
	written[0] = transform.p.x;
	written[1] = transform.p.y;
	written[2] = transform.q.c;
	written[3] = transform.q.s;
	written[4] = b2Rot_GetAngle( transform.q );
	written[5] = velocity.x;
	written[6] = velocity.y;
	written[7] = b2Body_GetAngularVelocity( bodyId );
	return written;
}

EMSCRIPTEN_KEEPALIVE void setTransform( int32_t index, int32_t tag, float x, float y, float cosine, float sine )
{
	b2Body_SetTransform( loadBodyId( index, tag ), ( b2Vec2 ){ x, y }, ( b2Rot ){ cosine, sine } );
}

EMSCRIPTEN_KEEPALIVE void setVelocity( int32_t index, int32_t tag, float x, float y )
{
	b2Body_SetLinearVelocity( loadBodyId( index, tag ), ( b2Vec2 ){ x, y } );
}

EMSCRIPTEN_KEEPALIVE void setAngularVelocity( int32_t index, int32_t tag, float angularVelocity )
{
	b2Body_SetAngularVelocity( loadBodyId( index, tag ), angularVelocity );
}

EMSCRIPTEN_KEEPALIVE void applyForce( int32_t index, int32_t tag, float x, float y )
{
	b2Body_ApplyForceToCenter( loadBodyId( index, tag ), ( b2Vec2 ){ x, y }, true );
}

EMSCRIPTEN_KEEPALIVE void applyImpulse( int32_t index, int32_t tag, float x, float y )
{
	b2Body_ApplyLinearImpulseToCenter( loadBodyId( index, tag ), ( b2Vec2 ){ x, y }, true );
}

EMSCRIPTEN_KEEPALIVE float getMass( int32_t index, int32_t tag )
{
	return b2Body_GetMass( loadBodyId( index, tag ) );
}

// Writes the contact count, then for each contact with points: normal x, normal y, separation, and
// the other body's type. The normal points toward this body.
EMSCRIPTEN_KEEPALIVE float* readContacts( int32_t index, int32_t tag )
{
	b2BodyId bodyId = loadBodyId( index, tag );
	int capacity = b2Body_GetContactCapacity( bodyId );
	b2ContactData* contacts = malloc( ( capacity ? capacity : 1 ) * sizeof( b2ContactData ) );
	int contactCount = b2Body_GetContactData( bodyId, contacts, capacity );
	float* written = reserveOutput( ( 1 + 4 * contactCount ) * sizeof( float ) );
	int writtenCount = 0;
	for ( int contactIndex = 0; contactIndex < contactCount; ++contactIndex )
	{
		b2ContactData* contact = contacts + contactIndex;
		if ( contact->manifold.pointCount == 0 )
		{
			continue;
		}
		bool isShapeA = b2Shape_GetBody( contact->shapeIdA ).index1 == bodyId.index1;
		// Box2D's normal points from shape A to shape B
		float direction = isShapeA ? -1.0f : 1.0f;
		float separation = contact->manifold.points[0].separation;
		for ( int pointIndex = 1; pointIndex < contact->manifold.pointCount; ++pointIndex )
		{
			separation = fminf( separation, contact->manifold.points[pointIndex].separation );
		}
		float* slot = written + 1 + 4 * writtenCount++;
		slot[0] = contact->manifold.normal.x * direction;
		slot[1] = contact->manifold.normal.y * direction;
		slot[2] = separation;
		slot[3] = (float)b2Body_GetType( b2Shape_GetBody( isShapeA ? contact->shapeIdB : contact->shapeIdA ) );
	}
	free( contacts );
	written[0] = (float)writtenCount;
	return written;
}

EMSCRIPTEN_KEEPALIVE void applyForceAtPoint( int32_t index, int32_t tag, float x, float y, float pointX, float pointY )
{
	b2Body_ApplyForce( loadBodyId( index, tag ), ( b2Vec2 ){ x, y }, ( b2Pos ){ pointX, pointY }, true );
}

EMSCRIPTEN_KEEPALIVE void applyImpulseAtPoint( int32_t index, int32_t tag, float x, float y, float pointX,
											   float pointY )
{
	b2Body_ApplyLinearImpulse( loadBodyId( index, tag ), ( b2Vec2 ){ x, y }, ( b2Pos ){ pointX, pointY }, true );
}

EMSCRIPTEN_KEEPALIVE void applyTorque( int32_t index, int32_t tag, float torque )
{
	b2Body_ApplyTorque( loadBodyId( index, tag ), torque, true );
}

EMSCRIPTEN_KEEPALIVE void applyAngularImpulse( int32_t index, int32_t tag, float impulse )
{
	b2Body_ApplyAngularImpulse( loadBodyId( index, tag ), impulse, true );
}

static float* writeVector( float x, float y )
{
	float* written = reserveOutput( 2 * sizeof( float ) );
	written[0] = x;
	written[1] = y;
	return written;
}

EMSCRIPTEN_KEEPALIVE float* getWorldPoint( int32_t index, int32_t tag, float x, float y )
{
	b2Pos point = b2Body_GetWorldPoint( loadBodyId( index, tag ), ( b2Vec2 ){ x, y } );
	return writeVector( point.x, point.y );
}

EMSCRIPTEN_KEEPALIVE float* getLocalPoint( int32_t index, int32_t tag, float x, float y )
{
	b2Vec2 point = b2Body_GetLocalPoint( loadBodyId( index, tag ), ( b2Pos ){ x, y } );
	return writeVector( point.x, point.y );
}

EMSCRIPTEN_KEEPALIVE float* getWorldVector( int32_t index, int32_t tag, float x, float y )
{
	b2Vec2 vector = b2Body_GetWorldVector( loadBodyId( index, tag ), ( b2Vec2 ){ x, y } );
	return writeVector( vector.x, vector.y );
}

EMSCRIPTEN_KEEPALIVE float* getLocalVector( int32_t index, int32_t tag, float x, float y )
{
	b2Vec2 vector = b2Body_GetLocalVector( loadBodyId( index, tag ), ( b2Vec2 ){ x, y } );
	return writeVector( vector.x, vector.y );
}

EMSCRIPTEN_KEEPALIVE float* getPointVelocity( int32_t index, int32_t tag, float x, float y )
{
	b2Vec2 velocity = b2Body_GetWorldPointVelocity( loadBodyId( index, tag ), ( b2Pos ){ x, y } );
	return writeVector( velocity.x, velocity.y );
}

static b2QueryFilter makeQueryFilter( uint64_t category, uint64_t mask )
{
	b2QueryFilter filter = b2DefaultQueryFilter();
	filter.categoryBits = category;
	filter.maskBits = mask;
	return filter;
}

// Writes a hit flag and the hit shape's entity id as two int32s, then the hit point x, y, the
// surface normal x, y, and the fraction of the translation traveled as floats.
static int32_t* writeHit( bool hit, b2ShapeId shapeId, b2Pos point, b2Vec2 normal, float fraction )
{
	int32_t* written = reserveOutput( 2 * sizeof( int32_t ) + 5 * sizeof( float ) );
	written[0] = hit;
	written[1] = hit ? (int32_t)(intptr_t)b2Shape_GetUserData( shapeId ) : 0;
	float* numbers = (float*)( written + 2 );
	numbers[0] = point.x;
	numbers[1] = point.y;
	numbers[2] = normal.x;
	numbers[3] = normal.y;
	numbers[4] = fraction;
	return written;
}

EMSCRIPTEN_KEEPALIVE int32_t* castRay( uint32_t world, float x, float y, float translationX, float translationY,
									   uint64_t category, uint64_t mask )
{
	b2RayResult result = b2World_CastRayClosest( b2LoadWorldId( world ), ( b2Pos ){ x, y },
												 ( b2Vec2 ){ translationX, translationY },
												 makeQueryFilter( category, mask ) );
	return writeHit( result.hit, result.shapeId, result.point, result.normal, result.fraction );
}

typedef struct ClosestHit
{
	bool hit;
	b2ShapeId shapeId;
	b2Pos point;
	b2Vec2 normal;
	float fraction;
} ClosestHit;

static float recordClosestHit( b2ShapeId shapeId, b2Pos point, b2Vec2 normal, float fraction, void* context )
{
	ClosestHit* closest = context;
	if ( !closest->hit || fraction < closest->fraction )
	{
		*closest = ( ClosestHit ){ true, shapeId, point, normal, fraction };
	}
	// returning the fraction makes Box2D skip anything farther away
	return fraction;
}

// Reads `pointCount` points (x, y each, relative to the shape's position and before its rotation)
// from the input buffer. The cast shape is the hull of those points, grown by `radius`.
EMSCRIPTEN_KEEPALIVE int32_t* castShape( uint32_t world, int pointCount, float radius, float x, float y, float cosine,
										 float sine, float translationX, float translationY, uint64_t category,
										 uint64_t mask )
{
	b2Rot rotation = { cosine, sine };
	b2Vec2* points = input;
	for ( int pointIndex = 0; pointIndex < pointCount; ++pointIndex )
	{
		points[pointIndex] = b2RotateVector( rotation, points[pointIndex] );
	}
	b2ShapeProxy proxy = b2MakeProxy( points, pointCount, radius );
	ClosestHit closest = { 0 };
	b2World_CastShape( b2LoadWorldId( world ), ( b2Pos ){ x, y }, &proxy, ( b2Vec2 ){ translationX, translationY },
					   makeQueryFilter( category, mask ), recordClosestHit, &closest );
	return writeHit( closest.hit, closest.shapeId, closest.point, closest.normal, closest.fraction );
}

// Writes the body type, then the enabled, bullet, and awake flags, then the motion lock bits, as int32s,
// then the gravity scale, linear damping, angular damping, and sleep threshold as floats.
EMSCRIPTEN_KEEPALIVE int32_t* readSettings( int32_t index, int32_t tag )
{
	b2BodyId bodyId = loadBodyId( index, tag );
	b2MotionLocks locks = b2Body_GetMotionLocks( bodyId );
	int32_t* written = reserveOutput( 9 * sizeof( int32_t ) );
	written[0] = b2Body_GetType( bodyId );
	written[1] = b2Body_IsEnabled( bodyId );
	written[2] = b2Body_IsBullet( bodyId );
	written[3] = b2Body_IsAwake( bodyId );
	written[4] = locks.linearX | locks.linearY << 1 | locks.angularZ << 2;
	float* numbers = (float*)( written + 5 );
	numbers[0] = b2Body_GetGravityScale( bodyId );
	numbers[1] = b2Body_GetLinearDamping( bodyId );
	numbers[2] = b2Body_GetAngularDamping( bodyId );
	numbers[3] = b2Body_GetSleepThreshold( bodyId );
	return written;
}

EMSCRIPTEN_KEEPALIVE void setBodyType( int32_t index, int32_t tag, int type )
{
	b2Body_SetType( loadBodyId( index, tag ), (b2BodyType)type );
}

EMSCRIPTEN_KEEPALIVE void setEnabled( int32_t index, int32_t tag, bool isEnabled )
{
	b2BodyId bodyId = loadBodyId( index, tag );
	if ( isEnabled )
	{
		b2Body_Enable( bodyId );
	}
	else
	{
		b2Body_Disable( bodyId );
	}
}

EMSCRIPTEN_KEEPALIVE void setBullet( int32_t index, int32_t tag, bool isBullet )
{
	b2Body_SetBullet( loadBodyId( index, tag ), isBullet );
}

EMSCRIPTEN_KEEPALIVE void setAwake( int32_t index, int32_t tag, bool isAwake )
{
	b2Body_SetAwake( loadBodyId( index, tag ), isAwake );
}

EMSCRIPTEN_KEEPALIVE void setGravityScale( int32_t index, int32_t tag, float gravityScale )
{
	b2Body_SetGravityScale( loadBodyId( index, tag ), gravityScale );
}

EMSCRIPTEN_KEEPALIVE void setMotionLocks( int32_t index, int32_t tag, int motionLocks )
{
	b2Body_SetMotionLocks( loadBodyId( index, tag ), loadMotionLocks( motionLocks ) );
}

EMSCRIPTEN_KEEPALIVE void setDamping( int32_t index, int32_t tag, float linearDamping, float angularDamping )
{
	b2BodyId bodyId = loadBodyId( index, tag );
	b2Body_SetLinearDamping( bodyId, linearDamping );
	b2Body_SetAngularDamping( bodyId, angularDamping );
}

EMSCRIPTEN_KEEPALIVE void setSleepThreshold( int32_t index, int32_t tag, float sleepThreshold )
{
	b2Body_SetSleepThreshold( loadBodyId( index, tag ), sleepThreshold );
}

EMSCRIPTEN_KEEPALIVE void setHitEvents( int32_t index, int32_t tag, bool isEnabled )
{
	b2Body_EnableHitEvents( loadBodyId( index, tag ), isEnabled );
}

// NaN mass goes back to the mass from the body's shapes.
EMSCRIPTEN_KEEPALIVE void setMassData( int32_t index, int32_t tag, float mass, float centerX, float centerY,
									   float rotationalInertia )
{
	b2BodyId bodyId = loadBodyId( index, tag );
	if ( isnan( mass ) )
	{
		b2Body_UpdateMassFromShapes( bodyId );
	}
	else
	{
		b2Body_SetMassData( bodyId, ( b2MassData ){ mass, { centerX, centerY }, rotationalInertia } );
	}
}

// Writes the mass, the center of mass x, y in body space, and the rotational inertia about it.
EMSCRIPTEN_KEEPALIVE float* readMassData( int32_t index, int32_t tag )
{
	b2MassData massData = b2Body_GetMassData( loadBodyId( index, tag ) );
	float* written = reserveOutput( 4 * sizeof( float ) );
	written[0] = massData.mass;
	written[1] = massData.center.x;
	written[2] = massData.center.y;
	written[3] = massData.rotationalInertia;
	return written;
}

EMSCRIPTEN_KEEPALIVE float* getLocalPointVelocity( int32_t index, int32_t tag, float x, float y )
{
	b2Vec2 velocity = b2Body_GetLocalPointVelocity( loadBodyId( index, tag ), ( b2Vec2 ){ x, y } );
	return writeVector( velocity.x, velocity.y );
}

// Writes the lower x, y and upper x, y corners of the box around every shape. A body without shapes
// gets a box around its position.
EMSCRIPTEN_KEEPALIVE float* computeBounds( int32_t index, int32_t tag )
{
	b2AABB box = b2Body_ComputeBounds( loadBodyId( index, tag ) );
	float* written = reserveOutput( 4 * sizeof( float ) );
	written[0] = box.lowerBound.x;
	written[1] = box.lowerBound.y;
	written[2] = box.upperBound.x;
	written[3] = box.upperBound.y;
	return written;
}

EMSCRIPTEN_KEEPALIVE void clearForces( int32_t index, int32_t tag )
{
	b2Body_ClearForces( loadBodyId( index, tag ) );
}

EMSCRIPTEN_KEEPALIVE void wakeTouching( int32_t index, int32_t tag )
{
	b2Body_WakeTouching( loadBodyId( index, tag ) );
}

// The caller frees the returned ids.
static b2ShapeId* readBodyShapes( b2BodyId bodyId, int* shapeCount )
{
	*shapeCount = b2Body_GetShapeCount( bodyId );
	b2ShapeId* shapeIds = malloc( ( *shapeCount ? *shapeCount : 1 ) * sizeof( b2ShapeId ) );
	b2Body_GetShapes( bodyId, shapeIds, *shapeCount );
	return shapeIds;
}

// Box2D only blows on circles, capsules, and polygons.
EMSCRIPTEN_KEEPALIVE void applyWind( int32_t index, int32_t tag, float windX, float windY, float drag, float lift )
{
	int shapeCount;
	b2ShapeId* shapeIds = readBodyShapes( loadBodyId( index, tag ), &shapeCount );
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		b2Shape_ApplyWind( shapeIds[shapeIndex], ( b2Vec2 ){ windX, windY }, drag, lift, true );
	}
	free( shapeIds );
}

// Same output as `castRay`, but only hits this body's shapes, ignoring filters.
EMSCRIPTEN_KEEPALIVE int32_t* castBodyRay( int32_t index, int32_t tag, float x, float y, float translationX,
										   float translationY )
{
	int shapeCount;
	b2ShapeId* shapeIds = readBodyShapes( loadBodyId( index, tag ), &shapeCount );
	ClosestHit closest = { 0 };
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		b2WorldCastOutput result =
			b2Shape_CastRay( shapeIds[shapeIndex], ( b2Pos ){ x, y }, ( b2Vec2 ){ translationX, translationY } );
		if ( result.hit )
		{
			recordClosestHit( shapeIds[shapeIndex], result.point, result.normal, result.fraction, &closest );
		}
	}
	free( shapeIds );
	return writeHit( closest.hit, closest.shapeId, closest.point, closest.normal, closest.fraction );
}

// Writes whether the body has shapes, then the x, y of the point on them closest to the target. A
// target inside a solid shape is its own closest point.
EMSCRIPTEN_KEEPALIVE float* getClosestPoint( int32_t index, int32_t tag, float x, float y )
{
	int shapeCount;
	b2ShapeId* shapeIds = readBodyShapes( loadBodyId( index, tag ), &shapeCount );
	b2Pos target = { x, y };
	b2Pos closest = target;
	float closestDistance = INFINITY;
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		b2Pos point = b2Shape_GetClosestPoint( shapeIds[shapeIndex], target );
		float distance = hypotf( point.x - x, point.y - y );
		if ( distance < closestDistance )
		{
			closest = point;
			closestDistance = distance;
		}
	}
	free( shapeIds );
	float* written = reserveOutput( 3 * sizeof( float ) );
	written[0] = (float)( shapeCount > 0 );
	written[1] = closest.x;
	written[2] = closest.y;
	return written;
}

EMSCRIPTEN_KEEPALIVE bool testPoint( int32_t index, int32_t tag, float x, float y )
{
	int shapeCount;
	b2ShapeId* shapeIds = readBodyShapes( loadBodyId( index, tag ), &shapeCount );
	bool isInside = false;
	for ( int shapeIndex = 0; shapeIndex < shapeCount && !isInside; ++shapeIndex )
	{
		isInside = b2Shape_TestPoint( shapeIds[shapeIndex], ( b2Pos ){ x, y } );
	}
	free( shapeIds );
	return isInside;
}

typedef struct OverlapList
{
	int32_t* entityIds;
	int count;
	int capacity;
} OverlapList;

static bool recordOverlap( b2ShapeId shapeId, void* context )
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
	b2ShapeId* shapeIds = readBodyShapes( loadBodyId( index, tag ), &shapeCount );
	OverlapList list = { 0 };
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		int capacity = b2Shape_GetSensorCapacity( shapeIds[shapeIndex] );
		b2ShapeId* visitorIds = malloc( ( capacity ? capacity : 1 ) * sizeof( b2ShapeId ) );
		int visitorCount = b2Shape_GetSensorData( shapeIds[shapeIndex], visitorIds, capacity );
		for ( int visitorIndex = 0; visitorIndex < visitorCount; ++visitorIndex )
		{
			// the list can still hold shapes destroyed since the last step
			if ( b2Shape_IsValid( visitorIds[visitorIndex] ) )
			{
				recordOverlap( visitorIds[visitorIndex], &list );
			}
		}
		free( visitorIds );
	}
	free( shapeIds );
	return writeOverlaps( &list );
}

EMSCRIPTEN_KEEPALIVE int32_t* overlapAabb( uint32_t world, float lowerX, float lowerY, float upperX, float upperY,
										   uint64_t category, uint64_t mask )
{
	OverlapList list = { 0 };
	b2AABB box = { { lowerX, lowerY }, { upperX, upperY } };
	b2World_OverlapAABB( b2LoadWorldId( world ), b2Pos_zero, box, makeQueryFilter( category, mask ), recordOverlap,
						 &list );
	return writeOverlaps( &list );
}

// Reads the shape the same way as `castShape`.
EMSCRIPTEN_KEEPALIVE int32_t* overlapShape( uint32_t world, int pointCount, float radius, float x, float y, float cosine,
											float sine, uint64_t category, uint64_t mask )
{
	b2Rot rotation = { cosine, sine };
	b2Vec2* points = input;
	for ( int pointIndex = 0; pointIndex < pointCount; ++pointIndex )
	{
		points[pointIndex] = b2RotateVector( rotation, points[pointIndex] );
	}
	b2ShapeProxy proxy = b2MakeProxy( points, pointCount, radius );
	OverlapList list = { 0 };
	b2World_OverlapShape( b2LoadWorldId( world ), ( b2Pos ){ x, y }, &proxy, makeQueryFilter( category, mask ),
						  recordOverlap, &list );
	return writeOverlaps( &list );
}

// Sets the material of every shape on the body. NaN, or -1 for `userMaterialId`, leaves that value
// unchanged.
EMSCRIPTEN_KEEPALIVE void setMaterial( int32_t index, int32_t tag, float density, float friction, float restitution,
									   float rollingResistance, float tangentSpeed, int32_t userMaterialId )
{
	b2BodyId bodyId = loadBodyId( index, tag );
	int shapeCount = b2Body_GetShapeCount( bodyId );
	b2ShapeId* shapeIds = malloc( shapeCount * sizeof( b2ShapeId ) );
	b2Body_GetShapes( bodyId, shapeIds, shapeCount );
	for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
	{
		if ( !isnan( density ) )
		{
			b2Shape_SetDensity( shapeIds[shapeIndex], density, false );
		}
		b2SurfaceMaterial material = b2Shape_GetSurfaceMaterial( shapeIds[shapeIndex] );
		material.friction = isnan( friction ) ? material.friction : friction;
		material.restitution = isnan( restitution ) ? material.restitution : restitution;
		material.rollingResistance = isnan( rollingResistance ) ? material.rollingResistance : rollingResistance;
		material.tangentSpeed = isnan( tangentSpeed ) ? material.tangentSpeed : tangentSpeed;
		material.userMaterialId = userMaterialId < 0 ? material.userMaterialId : (uint64_t)userMaterialId;
		b2Shape_SetSurfaceMaterial( shapeIds[shapeIndex], &material );
	}
	free( shapeIds );
	if ( !isnan( density ) )
	{
		b2Body_UpdateMassFromShapes( bodyId );
	}
}

EMSCRIPTEN_KEEPALIVE void setTargetTransform( int32_t index, int32_t tag, float x, float y, float cosine, float sine,
											  float seconds )
{
	b2Body_SetTargetTransform( loadBodyId( index, tag ), ( b2WorldTransform ){ { x, y }, { cosine, sine } }, seconds,
							   true );
}

EMSCRIPTEN_KEEPALIVE void explode( uint32_t world, float x, float y, float radius, float falloff,
								   float impulsePerLength, uint64_t mask )
{
	b2ExplosionDef def = b2DefaultExplosionDef();
	def.maskBits = mask;
	def.position = ( b2Pos ){ x, y };
	def.radius = radius;
	def.falloff = falloff;
	def.impulsePerLength = impulsePerLength;
	b2World_Explode( b2LoadWorldId( world ), &def );
}

EMSCRIPTEN_KEEPALIVE float castMover( uint32_t world, float x, float y, float center1X, float center1Y, float center2X,
									  float center2Y, float radius, float translationX, float translationY,
									  uint64_t category, uint64_t mask )
{
	b2Capsule mover = { { center1X, center1Y }, { center2X, center2Y }, radius };
	return b2World_CastMover( b2LoadWorldId( world ), ( b2Pos ){ x, y }, &mover, ( b2Vec2 ){ translationX, translationY },
							  makeQueryFilter( category, mask ) );
}

typedef struct PlaneList
{
	float* values;
	int count;
	int capacity;
} PlaneList;

// Each plane takes 6 floats: the entity id (as an int32), normal x, y, offset, and point x, y.
static bool recordPlane( b2ShapeId shapeId, const b2PlaneResult* result, void* context )
{
	PlaneList* list = context;
	if ( !result->hit )
	{
		return true;
	}
	if ( list->count == list->capacity )
	{
		list->capacity = list->capacity ? list->capacity * 2 : 8;
		list->values = realloc( list->values, list->capacity * 6 * sizeof( float ) );
	}
	float* plane = list->values + list->count * 6;
	( (int32_t*)plane )[0] = shapeEntity( shapeId );
	plane[1] = result->plane.normal.x;
	plane[2] = result->plane.normal.y;
	plane[3] = result->plane.offset;
	// Box2D v3.2.0 leaves the point in the hit shape's local frame, despite its docs saying the
	// point is relative to the query origin like the plane.
	b2Pos point = b2Body_GetWorldPoint( b2Shape_GetBody( shapeId ), result->point );
	plane[4] = point.x;
	plane[5] = point.y;
	++list->count;
	return true;
}

// Writes the plane count as an int32, then each plane as `recordPlane` lays it out.
EMSCRIPTEN_KEEPALIVE int32_t* collideMover( uint32_t world, float x, float y, float center1X, float center1Y,
											float center2X, float center2Y, float radius, uint64_t category,
											uint64_t mask )
{
	b2Capsule mover = { { center1X, center1Y }, { center2X, center2Y }, radius };
	PlaneList list = { 0 };
	b2World_CollideMover( b2LoadWorldId( world ), ( b2Pos ){ x, y }, &mover, makeQueryFilter( category, mask ),
						  recordPlane, &list );
	int32_t* written = reserveOutput( ( 1 + list.count * 6 ) * sizeof( int32_t ) );
	written[0] = list.count;
	memcpy( written + 1, list.values, list.count * 6 * sizeof( float ) );
	free( list.values );
	return written;
}

// Reads `planeCount` planes from the input buffer as normal x, y, offset, push limit, and clip
// velocity (0 or 1) floats. Writes the solved delta x, y, then `velocity` clipped against the planes
// the solve pushed on. `b2ClipVector` skips planes with no push, so it has to see this solve's planes.
EMSCRIPTEN_KEEPALIVE float* solveMoverPlanes( int planeCount, float targetX, float targetY, float velocityX,
											  float velocityY )
{
	float* values = input;
	b2CollisionPlane* planes = malloc( planeCount * sizeof( b2CollisionPlane ) );
	for ( int index = 0; index < planeCount; ++index )
	{
		float* value = values + index * 5;
		planes[index] = ( b2CollisionPlane ){ { { value[0], value[1] }, value[2] }, value[3], 0.0f, value[4] != 0.0f };
	}
	b2PlaneSolverResult result = b2SolvePlanes( ( b2Vec2 ){ targetX, targetY }, planes, planeCount );
	b2Vec2 velocity = b2ClipVector( ( b2Vec2 ){ velocityX, velocityY }, planes, planeCount );
	free( planes );
	float* written = reserveOutput( 4 * sizeof( float ) );
	written[0] = result.delta.x;
	written[1] = result.delta.y;
	written[2] = velocity.x;
	written[3] = velocity.y;
	return written;
}

// Joint settings arrive in the input buffer as floats in a fixed order per joint type. NaN keeps
// Box2D's default for that setting, and booleans arrive as 0 or 1.
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

static void readVector( b2Vec2* field )
{
	readFloat( &field->x );
	readFloat( &field->y );
}

// A frame is x, y, then an angle.
static void readFrame( b2Transform* frame )
{
	readVector( &frame->p );
	float angle = *nextInput++;
	if ( !isnan( angle ) )
	{
		frame->q = b2MakeRot( angle );
	}
}

// Every joint's settings start with frame A, frame B, force threshold, torque threshold, constraint
// hertz, constraint damping ratio, and collide connected.
static void readBase( b2JointDef* base )
{
	readFrame( &base->localFrameA );
	readFrame( &base->localFrameB );
	readFloat( &base->forceThreshold );
	readFloat( &base->torqueThreshold );
	readFloat( &base->constraintHertz );
	readFloat( &base->constraintDampingRatio );
	readBool( &base->collideConnected );
}

static void readDistance( b2DistanceJointDef* def )
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

static void readMotor( b2MotorJointDef* def )
{
	readVector( &def->linearVelocity );
	readFloat( &def->maxVelocityForce );
	readFloat( &def->angularVelocity );
	readFloat( &def->maxVelocityTorque );
	readFloat( &def->linearHertz );
	readFloat( &def->linearDampingRatio );
	readFloat( &def->maxSpringForce );
	readFloat( &def->angularHertz );
	readFloat( &def->angularDampingRatio );
	readFloat( &def->maxSpringTorque );
}

static void readMover( b2MoverJointDef* def )
{
	readVector( &def->linearVelocity );
	readVector( &def->maxVelocityForce );
}

static void readPogo( b2PogoJointDef* def )
{
	readVector( &def->normal );
	readFloat( &def->hertz );
	readFloat( &def->dampingRatio );
	readFloat( &def->restLength );
	readFloat( &def->maxTensionForce );
	readFloat( &def->maxCompressionForce );
	readFloat( &def->impulse );
	readFloat( &def->velocity );
}

static void readPrismatic( b2PrismaticJointDef* def )
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

static void readRevolute( b2RevoluteJointDef* def )
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

static void readWeld( b2WeldJointDef* def )
{
	readFloat( &def->linearHertz );
	readFloat( &def->angularHertz );
	readFloat( &def->linearDampingRatio );
	readFloat( &def->angularDampingRatio );
}

static void readWheel( b2WheelJointDef* def )
{
	readBool( &def->enableSpring );
	readFloat( &def->hertz );
	readFloat( &def->dampingRatio );
	readBool( &def->enableLimit );
	readFloat( &def->lowerTranslation );
	readFloat( &def->upperTranslation );
	readBool( &def->enableMotor );
	readFloat( &def->maxMotorTorque );
	readFloat( &def->motorSpeed );
}

typedef union JointDef
{
	b2DistanceJointDef distance;
	b2FilterJointDef filter;
	b2MotorJointDef motor;
	b2MoverJointDef mover;
	b2PogoJointDef pogo;
	b2PrismaticJointDef prismatic;
	b2RevoluteJointDef revolute;
	b2WeldJointDef weld;
	b2WheelJointDef wheel;
} JointDef;

// Every joint definition starts with its base, so `base` reads it for any joint type.
static b2JointDef* readJointDef( JointDef* def, b2JointType type )
{
	nextInput = input;
	b2JointDef* base = &def->distance.base;
	switch ( type )
	{
		case b2_distanceJoint:
			def->distance = b2DefaultDistanceJointDef();
			readBase( base );
			readDistance( &def->distance );
			break;
		case b2_filterJoint:
			def->filter = b2DefaultFilterJointDef();
			readBase( base );
			break;
		case b2_motorJoint:
			def->motor = b2DefaultMotorJointDef();
			readBase( base );
			readMotor( &def->motor );
			break;
		case b2_moverJoint:
			def->mover = b2DefaultMoverJointDef();
			readBase( base );
			readMover( &def->mover );
			break;
		case b2_pogoJoint:
			def->pogo = b2DefaultPogoJointDef();
			readBase( base );
			readPogo( &def->pogo );
			break;
		case b2_prismaticJoint:
			def->prismatic = b2DefaultPrismaticJointDef();
			readBase( base );
			readPrismatic( &def->prismatic );
			break;
		case b2_revoluteJoint:
			def->revolute = b2DefaultRevoluteJointDef();
			readBase( base );
			readRevolute( &def->revolute );
			break;
		case b2_weldJoint:
			def->weld = b2DefaultWeldJointDef();
			readBase( base );
			readWeld( &def->weld );
			break;
		case b2_wheelJoint:
			def->wheel = b2DefaultWheelJointDef();
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
	b2WorldId worldId = b2LoadWorldId( world );
	JointDef def;
	b2JointDef* base = readJointDef( &def, (b2JointType)type );
	base->bodyIdA = loadBodyId( indexA, tagA );
	base->bodyIdB = loadBodyId( indexB, tagB );
	base->userData = (void*)(intptr_t)jointId;
	b2JointId created = b2_nullJointId;
	switch ( (b2JointType)type )
	{
		case b2_distanceJoint:
			created = b2CreateDistanceJoint( worldId, &def.distance );
			break;
		case b2_filterJoint:
			created = b2CreateFilterJoint( worldId, &def.filter );
			break;
		case b2_motorJoint:
			created = b2CreateMotorJoint( worldId, &def.motor );
			break;
		case b2_moverJoint:
			created = b2CreateMoverJoint( worldId, &def.mover );
			break;
		case b2_pogoJoint:
			created = b2CreatePogoJoint( worldId, &def.pogo );
			break;
		case b2_prismaticJoint:
			created = b2CreatePrismaticJoint( worldId, &def.prismatic );
			break;
		case b2_revoluteJoint:
			created = b2CreateRevoluteJoint( worldId, &def.revolute );
			break;
		case b2_weldJoint:
			created = b2CreateWeldJoint( worldId, &def.weld );
			break;
		case b2_wheelJoint:
			created = b2CreateWheelJoint( worldId, &def.wheel );
			break;
	}
	return writeId( b2StoreJointId( created ) );
}

// Reads the joint's full settings from the input buffer, the same as `createJoint`, and applies them
// to the existing joint. Pogo joints only accept their spring settings here.
EMSCRIPTEN_KEEPALIVE void updateJoint( int32_t index, int32_t tag, int type )
{
	b2JointId jointId = loadJointId( index, tag );
	JointDef def;
	b2JointDef* base = readJointDef( &def, (b2JointType)type );
	b2Joint_SetLocalFrameA( jointId, base->localFrameA );
	b2Joint_SetLocalFrameB( jointId, base->localFrameB );
	b2Joint_SetForceThreshold( jointId, base->forceThreshold );
	b2Joint_SetTorqueThreshold( jointId, base->torqueThreshold );
	b2Joint_SetConstraintTuning( jointId, base->constraintHertz, base->constraintDampingRatio );
	b2Joint_SetCollideConnected( jointId, base->collideConnected );
	switch ( (b2JointType)type )
	{
		case b2_distanceJoint:
		{
			b2DistanceJointDef* distance = &def.distance;
			// setting the rest length drops the joint's accumulated impulse, even when it doesn't change
			if ( distance->length != b2DistanceJoint_GetRestLength( jointId ) )
			{
				b2DistanceJoint_SetRestLength( jointId, distance->length );
			}
			b2DistanceJoint_EnableSpring( jointId, distance->enableSpring );
			b2DistanceJoint_SetSpringForceRange( jointId, distance->lowerSpringForce, distance->upperSpringForce );
			b2DistanceJoint_SetSpringHertz( jointId, distance->hertz );
			b2DistanceJoint_SetSpringDampingRatio( jointId, distance->dampingRatio );
			b2DistanceJoint_EnableLimit( jointId, distance->enableLimit );
			b2DistanceJoint_SetLimits( jointId, distance->minLength, distance->maxLength );
			b2DistanceJoint_EnableMotor( jointId, distance->enableMotor );
			b2DistanceJoint_SetMaxMotorForce( jointId, distance->maxMotorForce );
			b2DistanceJoint_SetTargetMotorSpeed( jointId, distance->motorSpeed );
			break;
		}
		case b2_filterJoint:
			break;
		case b2_motorJoint:
		{
			b2MotorJointDef* motor = &def.motor;
			b2MotorJoint_SetLinearVelocity( jointId, motor->linearVelocity );
			b2MotorJoint_SetMaxVelocityForce( jointId, motor->maxVelocityForce );
			b2MotorJoint_SetAngularVelocity( jointId, motor->angularVelocity );
			b2MotorJoint_SetMaxVelocityTorque( jointId, motor->maxVelocityTorque );
			b2MotorJoint_SetLinearHertz( jointId, motor->linearHertz );
			b2MotorJoint_SetLinearDampingRatio( jointId, motor->linearDampingRatio );
			b2MotorJoint_SetMaxSpringForce( jointId, motor->maxSpringForce );
			b2MotorJoint_SetAngularHertz( jointId, motor->angularHertz );
			b2MotorJoint_SetAngularDampingRatio( jointId, motor->angularDampingRatio );
			b2MotorJoint_SetMaxSpringTorque( jointId, motor->maxSpringTorque );
			break;
		}
		case b2_moverJoint:
			b2MoverJoint_SetLinearVelocity( jointId, def.mover.linearVelocity );
			b2MoverJoint_SetMaxVelocityForce( jointId, def.mover.maxVelocityForce );
			break;
		case b2_pogoJoint:
			b2PogoJoint_SetRestLength( jointId, def.pogo.restLength );
			b2PogoJoint_SetSpringHertz( jointId, def.pogo.hertz );
			b2PogoJoint_SetSpringDampingRatio( jointId, def.pogo.dampingRatio );
			break;
		case b2_prismaticJoint:
		{
			b2PrismaticJointDef* prismatic = &def.prismatic;
			b2PrismaticJoint_EnableSpring( jointId, prismatic->enableSpring );
			b2PrismaticJoint_SetSpringHertz( jointId, prismatic->hertz );
			b2PrismaticJoint_SetSpringDampingRatio( jointId, prismatic->dampingRatio );
			b2PrismaticJoint_SetTargetTranslation( jointId, prismatic->targetTranslation );
			b2PrismaticJoint_EnableLimit( jointId, prismatic->enableLimit );
			b2PrismaticJoint_SetLimits( jointId, prismatic->lowerTranslation, prismatic->upperTranslation );
			b2PrismaticJoint_EnableMotor( jointId, prismatic->enableMotor );
			b2PrismaticJoint_SetMaxMotorForce( jointId, prismatic->maxMotorForce );
			b2PrismaticJoint_SetTargetMotorSpeed( jointId, prismatic->motorSpeed );
			break;
		}
		case b2_revoluteJoint:
		{
			b2RevoluteJointDef* revolute = &def.revolute;
			b2RevoluteJoint_SetTargetAngle( jointId, revolute->targetAngle );
			b2RevoluteJoint_EnableSpring( jointId, revolute->enableSpring );
			b2RevoluteJoint_SetSpringHertz( jointId, revolute->hertz );
			b2RevoluteJoint_SetSpringDampingRatio( jointId, revolute->dampingRatio );
			b2RevoluteJoint_EnableLimit( jointId, revolute->enableLimit );
			b2RevoluteJoint_SetLimits( jointId, revolute->lowerAngle, revolute->upperAngle );
			b2RevoluteJoint_EnableMotor( jointId, revolute->enableMotor );
			b2RevoluteJoint_SetMaxMotorTorque( jointId, revolute->maxMotorTorque );
			b2RevoluteJoint_SetTargetMotorSpeed( jointId, revolute->motorSpeed );
			break;
		}
		case b2_weldJoint:
			b2WeldJoint_SetLinearHertz( jointId, def.weld.linearHertz );
			b2WeldJoint_SetAngularHertz( jointId, def.weld.angularHertz );
			b2WeldJoint_SetLinearDampingRatio( jointId, def.weld.linearDampingRatio );
			b2WeldJoint_SetAngularDampingRatio( jointId, def.weld.angularDampingRatio );
			break;
		case b2_wheelJoint:
		{
			b2WheelJointDef* wheel = &def.wheel;
			b2WheelJoint_EnableSpring( jointId, wheel->enableSpring );
			b2WheelJoint_SetSpringHertz( jointId, wheel->hertz );
			b2WheelJoint_SetSpringDampingRatio( jointId, wheel->dampingRatio );
			b2WheelJoint_EnableLimit( jointId, wheel->enableLimit );
			b2WheelJoint_SetLimits( jointId, wheel->lowerTranslation, wheel->upperTranslation );
			b2WheelJoint_EnableMotor( jointId, wheel->enableMotor );
			b2WheelJoint_SetMaxMotorTorque( jointId, wheel->maxMotorTorque );
			b2WheelJoint_SetTargetMotorSpeed( jointId, wheel->motorSpeed );
			break;
		}
	}
	b2Joint_WakeBodies( jointId );
}

// Writes the constraint force x, y, constraint torque, linear separation, and angular separation,
// then up to three readings that depend on the joint type.
EMSCRIPTEN_KEEPALIVE float* readJoint( int32_t index, int32_t tag, int type )
{
	b2JointId jointId = loadJointId( index, tag );
	b2Vec2 force = b2Joint_GetConstraintForce( jointId );
	float* written = reserveOutput( 8 * sizeof( float ) );
	written[0] = force.x;
	written[1] = force.y;
	written[2] = b2Joint_GetConstraintTorque( jointId );
	written[3] = b2Joint_GetLinearSeparation( jointId );
	written[4] = b2Joint_GetAngularSeparation( jointId );
	float* extra = written + 5;
	switch ( (b2JointType)type )
	{
		case b2_distanceJoint:
			extra[0] = b2DistanceJoint_GetCurrentLength( jointId );
			extra[1] = b2DistanceJoint_GetSpringForce( jointId );
			extra[2] = b2DistanceJoint_GetCurrentMotorForce( jointId );
			break;
		case b2_pogoJoint:
			extra[0] = b2PogoJoint_GetCurrentLength( jointId );
			extra[1] = b2PogoJoint_GetCurrentSpeed( jointId );
			extra[2] = b2PogoJoint_GetImpulse( jointId );
			break;
		case b2_prismaticJoint:
			extra[0] = b2PrismaticJoint_GetCurrentTranslation( jointId );
			extra[1] = b2PrismaticJoint_GetCurrentSpeed( jointId );
			extra[2] = b2PrismaticJoint_GetCurrentMotorForce( jointId );
			break;
		case b2_revoluteJoint:
			extra[0] = b2RevoluteJoint_GetCurrentAngle( jointId );
			extra[1] = b2RevoluteJoint_GetCurrentSpeed( jointId );
			extra[2] = b2RevoluteJoint_GetCurrentMotorTorque( jointId );
			break;
		case b2_wheelJoint:
			extra[0] = b2WheelJoint_GetCurrentMotorTorque( jointId );
			break;
		default:
			break;
	}
	return written;
}

EMSCRIPTEN_KEEPALIVE void destroyJoint( int32_t index, int32_t tag )
{
	b2JointId jointId = loadJointId( index, tag );
	if ( b2Joint_IsValid( jointId ) )
	{
		b2DestroyJoint( jointId );
	}
}

// A native snapshot starts with this, then the ids of the kept bodies, the dropped bodies, and the
// joints (two numbers each, as JavaScript holds them), the tracked shapes, the passing pairs, and
// last Box2D's own snapshot image.
typedef struct SnapshotHeader
{
	int32_t magic;
	int32_t size;
	int32_t bodyCount;
	int32_t droppedCount;
	int32_t jointCount;
	int32_t shapeCapacity;
	int32_t passingCount;
	int32_t box2dSize;
} SnapshotHeader;

static const int32_t snapshotMagic = 0x32544e41;

typedef struct SnapshotLayout
{
	int64_t shapesOffset;
	int64_t passingOffset;
	int64_t box2dOffset;
	int64_t size;
} SnapshotLayout;

static SnapshotLayout layOutSnapshot( const SnapshotHeader* header )
{
	SnapshotLayout layout;
	layout.shapesOffset = (int64_t)sizeof( SnapshotHeader ) +
						  ( (int64_t)header->bodyCount + header->droppedCount + header->jointCount ) * 2 * sizeof( int32_t );
	layout.passingOffset = layout.shapesOffset + (int64_t)header->shapeCapacity * sizeof( TrackedShape );
	layout.box2dOffset = layout.passingOffset + (int64_t)header->passingCount * sizeof( PassingPair );
	layout.size = layout.box2dOffset + header->box2dSize;
	return layout;
}

// Reads the ids of the kept bodies, the dropped bodies, then the joints from the input buffer. Must
// be called between steps.
EMSCRIPTEN_KEEPALIVE int32_t* createSnapshot( uint32_t world, int bodyCount, int droppedCount, int jointCount )
{
	b2WorldId worldId = b2LoadWorldId( world );
	TrackedWorld* trackedWorld = trackedWorlds + worldId.index1 - 1;
	SnapshotHeader header = { snapshotMagic,
							  0,
							  bodyCount,
							  droppedCount,
							  jointCount,
							  trackedWorld->shapeCapacity,
							  trackedWorld->passingCount,
							  b2World_GetSnapshot( worldId, NULL, 0 ) };
	SnapshotLayout layout = layOutSnapshot( &header );
	header.size = (int32_t)layout.size;
	uint8_t* image = reserveOutput( header.size );
	memcpy( image, &header, sizeof( header ) );
	memcpy( image + sizeof( header ), input, layout.shapesOffset - sizeof( header ) );
	memcpy( image + layout.shapesOffset, trackedWorld->shapes, layout.passingOffset - layout.shapesOffset );
	memcpy( image + layout.passingOffset, trackedWorld->passingPairs, layout.box2dOffset - layout.passingOffset );
	b2World_GetSnapshot( worldId, image + layout.box2dOffset, header.box2dSize );
	return (int32_t*)image;
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
		 header.jointCount < 0 || header.shapeCapacity < 0 || header.passingCount < 0 || header.box2dSize < 0 ||
		 layOutSnapshot( &header ).size != size )
	{
		return false;
	}
	b2WorldId scratchId = b2CreateWorldFromSnapshot( (uint8_t*)input + layOutSnapshot( &header ).box2dOffset,
													 header.box2dSize, 0 );
	if ( B2_IS_NULL( scratchId ) )
	{
		return false;
	}
	b2DestroyWorld( scratchId );
	return true;
}

// Stored ids name the world they were made in, which `reset` may have replaced.
static uint64_t moveIdToWorld( const int32_t* savedId, uint16_t world0 )
{
	return loadId( savedId[0], ( (uint32_t)world0 << 16 ) | ( (uint32_t)savedId[1] & 0xFFFF ) );
}

// Restores a snapshot from the input buffer that `isValidSnapshot` accepted. After the snapshot, at
// the next multiple of 4 bytes, the input holds the entity id for each kept body and then the
// joint id for each joint, which replace the ones they had when the snapshot was made. Destroys
// the dropped bodies and returns the restored ids of the kept bodies and then the joints.
EMSCRIPTEN_KEEPALIVE int32_t* restoreSnapshot( uint32_t world, int size )
{
	b2WorldId worldId = b2LoadWorldId( world );
	uint16_t world0 = worldId.index1 - 1;
	const uint8_t* image = input;
	SnapshotHeader header;
	memcpy( &header, image, sizeof( header ) );
	SnapshotLayout layout = layOutSnapshot( &header );
	if ( !b2World_RestoreFromSnapshot( worldId, image + layout.box2dOffset, header.box2dSize ) )
	{
		return NULL;
	}

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
	memcpy( trackedWorld->passingPairs, image + layout.passingOffset, layout.box2dOffset - layout.passingOffset );
	for ( int index = 0; index < header.passingCount; ++index )
	{
		trackedWorld->passingPairs[index].oneWayShape.world0 = world0;
		trackedWorld->passingPairs[index].otherShape.world0 = world0;
	}

	const int32_t* savedIds = (const int32_t*)( image + sizeof( header ) );
	const int32_t* userValues = (const int32_t*)( image + ( ( size + 3 ) & ~3 ) );
	int32_t* restoredIds = reserveOutput( ( header.bodyCount + header.jointCount ) * 2 * sizeof( int32_t ) );
	for ( int index = 0; index < header.bodyCount; ++index )
	{
		uint64_t stored = moveIdToWorld( savedIds + 2 * index, world0 );
		b2BodyId bodyId = b2LoadBodyId( stored );
		void* userData = (void*)(intptr_t)userValues[index];
		b2Body_SetUserData( bodyId, userData );
		int shapeCount;
		b2ShapeId* shapeIds = readBodyShapes( bodyId, &shapeCount );
		for ( int shapeIndex = 0; shapeIndex < shapeCount; ++shapeIndex )
		{
			b2Shape_SetUserData( shapeIds[shapeIndex], userData );
		}
		free( shapeIds );
		restoredIds[2 * index] = (int32_t)( stored >> 32 );
		restoredIds[2 * index + 1] = (int32_t)( stored & 0xFFFFFFFF );
	}
	for ( int index = 0; index < header.droppedCount; ++index )
	{
		b2DestroyBody( b2LoadBodyId( moveIdToWorld( savedIds + 2 * ( header.bodyCount + index ), world0 ) ) );
	}
	for ( int index = 0; index < header.jointCount; ++index )
	{
		uint64_t stored = moveIdToWorld( savedIds + 2 * ( header.bodyCount + header.droppedCount + index ), world0 );
		b2Joint_SetUserData( b2LoadJointId( stored ), (void*)(intptr_t)userValues[header.bodyCount + index] );
		restoredIds[2 * ( header.bodyCount + index )] = (int32_t)( stored >> 32 );
		restoredIds[2 * ( header.bodyCount + index ) + 1] = (int32_t)( stored & 0xFFFFFFFF );
	}
	return restoredIds;
}

EMSCRIPTEN_KEEPALIVE int32_t getAwakeBodyCount( uint32_t world )
{
	return b2World_GetAwakeBodyCount( b2LoadWorldId( world ) );
}

EMSCRIPTEN_KEEPALIVE float* readProfile( uint32_t world )
{
	b2Profile profile = b2World_GetProfile( b2LoadWorldId( world ) );
	float* written = reserveOutput( sizeof( b2Profile ) );
	memcpy( written, &profile, sizeof( b2Profile ) );
	return written;
}

EMSCRIPTEN_KEEPALIVE int32_t* readCounters( uint32_t world )
{
	b2Counters counters = b2World_GetCounters( b2LoadWorldId( world ) );
	int32_t* written = reserveOutput( ( 12 + B2_GRAPH_COLOR_COUNT ) * sizeof( int32_t ) );
	int32_t values[] = { (int32_t)counters.byteCount,  counters.bodyCount,		   counters.shapeCount,
						 counters.contactCount,		   counters.jointCount,		   counters.islandCount,
						 counters.stackUsed,		   counters.staticTreeHeight,  counters.treeHeight,
						 counters.taskCount,		   counters.awakeContactCount, counters.recycledContactCount };
	memcpy( written, values, sizeof( values ) );
	memcpy( written + 12, counters.colorCounts, B2_GRAPH_COLOR_COUNT * sizeof( int32_t ) );
	return written;
}

// Debug drawing collects every primitive Box2D draws into one buffer of floats, so JavaScript reads
// them all after one call instead of being called once per primitive. Each primitive starts with its
// `DrawKind`. Colors are 24-bit, so floats hold them exactly.
typedef enum DrawKind
{
	drawPolygon,
	drawSolidPolygon,
	drawCircle,
	drawSolidCircle,
	drawSolidCapsule,
	drawLine,
	drawTransform,
	drawPoint,
	drawString,
	drawBounds,
} DrawKind;

static float* drawing = NULL;
static int drawingCount = 0;
static int drawingCapacity = 0;

static void pushDrawing( const float* values, int count )
{
	if ( drawingCount + count > drawingCapacity )
	{
		drawingCapacity = ( drawingCount + count ) * 2;
		drawing = realloc( drawing, drawingCapacity * sizeof( float ) );
	}
	memcpy( drawing + drawingCount, values, count * sizeof( float ) );
	drawingCount += count;
}

static void pushPolygon( DrawKind kind, b2Transform transform, const b2Vec2* vertices, int vertexCount )
{
	float header[] = { kind, vertexCount };
	pushDrawing( header, 2 );
	for ( int index = 0; index < vertexCount; ++index )
	{
		b2Vec2 point = b2TransformPoint( transform, vertices[index] );
		pushDrawing( (float*)&point, 2 );
	}
}

static void collectPolygon( b2Transform transform, const b2Vec2* vertices, int vertexCount, b2HexColor color,
							void* context )
{
	pushPolygon( drawPolygon, transform, vertices, vertexCount );
	float rest[] = { color };
	pushDrawing( rest, 1 );
}

static void collectSolidPolygon( b2Transform transform, const b2Vec2* vertices, int vertexCount, float radius,
								 b2HexColor color, void* context )
{
	pushPolygon( drawSolidPolygon, transform, vertices, vertexCount );
	float rest[] = { radius, color };
	pushDrawing( rest, 2 );
}

static void collectCircle( b2Vec2 center, float radius, b2HexColor color, void* context )
{
	float values[] = { drawCircle, center.x, center.y, radius, color };
	pushDrawing( values, 5 );
}

static void collectSolidCircle( b2Transform transform, b2Vec2 center, float radius, b2HexColor color, void* context )
{
	b2Vec2 worldCenter = b2TransformPoint( transform, center );
	float values[] = { drawSolidCircle, worldCenter.x, worldCenter.y, radius, b2Rot_GetAngle( transform.q ), color };
	pushDrawing( values, 6 );
}

static void collectSolidCapsule( b2Vec2 p1, b2Vec2 p2, float radius, b2HexColor color, void* context )
{
	float values[] = { drawSolidCapsule, p1.x, p1.y, p2.x, p2.y, radius, color };
	pushDrawing( values, 7 );
}

static void collectLine( b2Vec2 p1, b2Vec2 p2, b2HexColor color, void* context )
{
	float values[] = { drawLine, p1.x, p1.y, p2.x, p2.y, color };
	pushDrawing( values, 6 );
}

static void collectTransform( b2Transform transform, void* context )
{
	float values[] = { drawTransform, transform.p.x, transform.p.y, b2Rot_GetAngle( transform.q ) };
	pushDrawing( values, 4 );
}

static void collectPoint( b2Vec2 p, float size, b2HexColor color, void* context )
{
	float values[] = { drawPoint, p.x, p.y, size, color };
	pushDrawing( values, 5 );
}

static void collectString( b2Vec2 p, const char* text, b2HexColor color, void* context )
{
	int length = (int)strlen( text );
	float values[] = { drawString, p.x, p.y, color, length };
	pushDrawing( values, 5 );
	for ( int index = 0; index < length; ++index )
	{
		float character = (unsigned char)text[index];
		pushDrawing( &character, 1 );
	}
}

static void collectBounds( b2AABB bounds, b2HexColor color, void* context )
{
	float values[] = { drawBounds, bounds.lowerBound.x, bounds.lowerBound.y, bounds.upperBound.x,
					   bounds.upperBound.y, color };
	pushDrawing( values, 6 );
}

// Reads the drawing options JavaScript wrote to `input`: the drawing bounds, force scale, joint
// scale, then one flag per `b2DebugDraw` option, in the order they are declared.
static b2DebugDraw readDebugDraw( void )
{
	const float* options = input;
	b2DebugDraw draw = b2DefaultDebugDraw();
	draw.DrawPolygonFcn = collectPolygon;
	draw.DrawSolidPolygonFcn = collectSolidPolygon;
	draw.DrawCircleFcn = collectCircle;
	draw.DrawSolidCircleFcn = collectSolidCircle;
	draw.DrawSolidCapsuleFcn = collectSolidCapsule;
	draw.DrawLineFcn = collectLine;
	draw.DrawTransformFcn = collectTransform;
	draw.DrawPointFcn = collectPoint;
	draw.DrawStringFcn = collectString;
	draw.DrawBoundsFcn = collectBounds;
	draw.drawingBounds = ( b2AABB ){ { options[0], options[1] }, { options[2], options[3] } };
	draw.forceScale = options[4];
	draw.jointScale = options[5];
	bool* flags[] = { &draw.drawContacts,		  &draw.drawAnchorA,		 &draw.drawShapes,
					  &draw.drawChainNormals,	  &draw.drawJoints,			 &draw.drawJointExtras,
					  &draw.drawBounds,			  &draw.drawMass,			 &draw.drawBodyNames,
					  &draw.drawGraphColors,	  &draw.drawContactFeatures, &draw.drawContactNormals,
					  &draw.drawContactForces,	  &draw.drawFrictionForces,	 &draw.drawIslands };
	for ( int index = 0; index < (int)( sizeof( flags ) / sizeof( flags[0] ) ); ++index )
	{
		*flags[index] = options[6 + index] != 0.0f;
	}
	return draw;
}

// Returns where the drawing starts and how many floats it has.
static int32_t* finishDrawing( void )
{
	int32_t* written = reserveOutput( 2 * sizeof( int32_t ) );
	written[0] = (int32_t)(intptr_t)drawing;
	written[1] = drawingCount;
	return written;
}

EMSCRIPTEN_KEEPALIVE int32_t* drawWorld( uint32_t world )
{
	b2DebugDraw draw = readDebugDraw();
	drawingCount = 0;
	b2World_Draw( b2LoadWorldId( world ), &draw );
	return finishDrawing();
}

typedef enum RecordingResult
{
	recordingStarted,
	recordingAlready,
	recordingHasHooks,
	recordingHasPreSolveShapes,
} RecordingResult;

static bool hasPreSolveShapes( b2WorldId worldId )
{
	TrackedWorld* world = trackedWorlds + worldId.index1 - 1;
	for ( int index = 0; index < world->shapeCapacity; ++index )
	{
		TrackedShape* shape = world->shapes + index;
		b2ShapeId shapeId = { index + 1, worldId.index1 - 1, shape->generation };
		if ( ( shape->isOneWay || shape->enablePreSolve ) && b2Shape_IsValid( shapeId ) )
		{
			return true;
		}
	}
	return false;
}

// Box2D can't record worlds with a pre-solve callback, and replays leave out every callback. The
// pre-solve callback only runs for shapes that enable pre-solve events, so without any it can go
// until recording stops.
EMSCRIPTEN_KEEPALIVE int32_t startRecording( uint32_t world )
{
	b2WorldId worldId = b2LoadWorldId( world );
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
	b2World_SetPreSolveCallback( worldId, NULL, NULL, NULL );
	trackedWorld->recording = b2CreateRecording( 0 );
	b2World_StartRecording( worldId, trackedWorld->recording );
	return recordingStarted;
}

EMSCRIPTEN_KEEPALIVE bool isRecordingBody( int32_t index, int32_t tag )
{
	b2WorldId worldId = b2Body_GetWorld( loadBodyId( index, tag ) );
	return trackedWorlds[worldId.index1 - 1].recording != NULL;
}

EMSCRIPTEN_KEEPALIVE bool isRecording( uint32_t world )
{
	return trackedWorlds[b2LoadWorldId( world ).index1 - 1].recording != NULL;
}

// Writes the recording's size, then its bytes. Returns NULL when the world isn't recording.
EMSCRIPTEN_KEEPALIVE int32_t* stopRecording( uint32_t world )
{
	b2WorldId worldId = b2LoadWorldId( world );
	TrackedWorld* trackedWorld = trackedWorlds + worldId.index1 - 1;
	if ( !trackedWorld->recording )
	{
		return NULL;
	}
	b2World_StopRecording( worldId );
	int size = b2Recording_GetSize( trackedWorld->recording );
	int32_t* written = reserveOutput( sizeof( int32_t ) + size );
	written[0] = size;
	memcpy( written + 1, b2Recording_GetData( trackedWorld->recording ), size );
	b2DestroyRecording( trackedWorld->recording );
	trackedWorld->recording = NULL;
	b2World_SetPreSolveCallback( worldId, preSolve, preContinuous, (void*)(uintptr_t)world );
	return written;
}

// Recordings are read from `input`, `size` bytes long.
EMSCRIPTEN_KEEPALIVE bool validateRecording( int size )
{
	return b2ValidateRecording( input, size, 0 );
}

EMSCRIPTEN_KEEPALIVE b2Replay* createReplay( int size )
{
	return b2CreateReplay( input, size, 0 );
}

EMSCRIPTEN_KEEPALIVE void destroyReplay( b2Replay* replay )
{
	b2DestroyReplay( replay );
}

EMSCRIPTEN_KEEPALIVE bool stepReplayFrame( b2Replay* replay )
{
	return b2Replay_StepFrame( replay );
}

EMSCRIPTEN_KEEPALIVE void restartReplay( b2Replay* replay )
{
	b2Replay_Restart( replay );
}

EMSCRIPTEN_KEEPALIVE void seekReplayFrame( b2Replay* replay, int frame )
{
	b2Replay_SeekFrame( replay, frame );
}

EMSCRIPTEN_KEEPALIVE int32_t* readReplayStatus( b2Replay* replay )
{
	int32_t* written = reserveOutput( 8 * sizeof( int32_t ) );
	written[0] = b2Replay_GetFrame( replay );
	written[1] = b2Replay_IsAtEnd( replay );
	written[2] = b2Replay_GetDivergeFrame( replay );
	written[3] = (int32_t)b2Replay_GetKeyframeBudget( replay );
	written[4] = b2Replay_GetKeyframeMinInterval( replay );
	written[5] = b2Replay_GetKeyframeInterval( replay );
	written[6] = (int32_t)b2Replay_GetKeyframeBytes( replay );
	written[7] = b2Replay_GetFrameQueryCount( replay );
	return written;
}

EMSCRIPTEN_KEEPALIVE float* readReplayInfo( b2Replay* replay )
{
	b2ReplayInfo info = b2Replay_GetInfo( replay );
	float* written = reserveOutput( 8 * sizeof( float ) );
	float values[] = { info.frameCount,			  info.timeStep,		   info.subStepCount,
					   info.lengthScale,		  info.bounds.lowerBound.x, info.bounds.lowerBound.y,
					   info.bounds.upperBound.x, info.bounds.upperBound.y };
	memcpy( written, values, sizeof( values ) );
	return written;
}

EMSCRIPTEN_KEEPALIVE void setReplayKeyframePolicy( b2Replay* replay, int budgetBytes, int minIntervalFrames )
{
	b2Replay_SetKeyframePolicy( replay, budgetBytes, minIntervalFrames );
}

// Writes the body count, then each body's creation order slot as whether it exists, then its x, y,
// and angle.
EMSCRIPTEN_KEEPALIVE float* readReplayBodies( b2Replay* replay )
{
	int count = b2Replay_GetBodyCount( replay );
	float* written = reserveOutput( ( 1 + 4 * count ) * sizeof( float ) );
	written[0] = count;
	for ( int index = 0; index < count; ++index )
	{
		b2BodyId bodyId = b2Replay_GetBodyId( replay, index );
		bool exists = b2Body_IsValid( bodyId );
		b2Transform transform = exists ? b2Body_GetTransform( bodyId ) : b2Transform_identity;
		float values[] = { exists, transform.p.x, transform.p.y, b2Rot_GetAngle( transform.q ) };
		memcpy( written + 1 + 4 * index, values, sizeof( values ) );
	}
	return written;
}

static int findReplayBody( b2Replay* replay, b2BodyId bodyId )
{
	int count = b2Replay_GetBodyCount( replay );
	for ( int index = 0; index < count; ++index )
	{
		if ( B2_ID_EQUALS( b2Replay_GetBodyId( replay, index ), bodyId ) )
		{
			return index;
		}
	}
	return -1;
}

typedef struct ReplayQuery
{
	int32_t type;
	uint32_t category[2];
	uint32_t mask[2];
	float bounds[4];
	float origin[2];
	float translation[2];
	int32_t hitCount;
} ReplayQuery;

typedef struct ReplayQueryHit
{
	int32_t bodyIndex;
	float point[2];
	float normal[2];
	float fraction;
} ReplayQueryHit;

// Writes the query, then each of its hits.
EMSCRIPTEN_KEEPALIVE ReplayQuery* readReplayQuery( b2Replay* replay, int queryIndex )
{
	b2ReplayQueryInfo info = b2Replay_GetFrameQuery( replay, queryIndex );
	ReplayQuery* query = reserveOutput( sizeof( ReplayQuery ) + info.hitCount * sizeof( ReplayQueryHit ) );
	*query = ( ReplayQuery ){
		info.type,
		{ (uint32_t)info.filter.categoryBits, (uint32_t)( info.filter.categoryBits >> 32 ) },
		{ (uint32_t)info.filter.maskBits, (uint32_t)( info.filter.maskBits >> 32 ) },
		{ info.aabb.lowerBound.x, info.aabb.lowerBound.y, info.aabb.upperBound.x, info.aabb.upperBound.y },
		{ info.origin.x, info.origin.y },
		{ info.translation.x, info.translation.y },
		info.hitCount,
	};
	ReplayQueryHit* hits = (ReplayQueryHit*)( query + 1 );
	for ( int index = 0; index < info.hitCount; ++index )
	{
		b2ReplayQueryHit hit = b2Replay_GetFrameQueryHit( replay, queryIndex, index );
		int bodyIndex = b2Shape_IsValid( hit.shapeId ) ? findReplayBody( replay, b2Shape_GetBody( hit.shapeId ) ) : -1;
		hits[index] = ( ReplayQueryHit ){
			bodyIndex, { hit.point.x, hit.point.y }, { hit.normal.x, hit.normal.y }, hit.fraction,
		};
	}
	return query;
}

// Draws the replayed world, then the queries of the last replayed frame: all of them for
// `queryIndex` -1, or none for -2.
EMSCRIPTEN_KEEPALIVE int32_t* drawReplay( b2Replay* replay, int queryIndex )
{
	b2DebugDraw draw = readDebugDraw();
	drawingCount = 0;
	b2World_Draw( b2Replay_GetWorldId( replay ), &draw );
	if ( queryIndex != -2 )
	{
		b2Replay_DrawFrameQueries( replay, &draw, queryIndex );
	}
	return finishDrawing();
}

// Standalone geometry. JavaScript writes each shape into the input buffer as `geometryShapeFloats`
// floats: its kind, radius, point count, then up to 8 points. A second shape follows the first.
enum
{
	geometryCircle,
	geometryCapsule,
	geometrySegment,
	geometryPolygon,
	geometryChainSegment,
};

#define geometryShapeFloats ( 3 + 2 * B2_MAX_POLYGON_VERTICES )

typedef struct GeometryShape
{
	int kind;
	b2Circle circle;
	b2Capsule capsule;
	b2Segment segment;
	b2Polygon polygon;
	b2ChainSegment chainSegment;
	b2ShapeProxy proxy;
} GeometryShape;

// Returns false when polygon points all lie on one line.
static bool loadGeometryShape( int slot, GeometryShape* shape )
{
	float* floats = (float*)input + slot * geometryShapeFloats;
	float radius = floats[1];
	int count = (int)floats[2];
	b2Vec2* points = (b2Vec2*)( floats + 3 );
	*shape = ( GeometryShape ){ .kind = (int)floats[0] };
	switch ( shape->kind )
	{
		case geometryCircle:
			shape->circle = ( b2Circle ){ points[0], radius };
			shape->proxy = b2MakeProxy( points, 1, radius );
			return true;
		case geometryCapsule:
			shape->capsule = ( b2Capsule ){ points[0], points[1], radius };
			shape->proxy = b2MakeProxy( points, 2, radius );
			return true;
		case geometrySegment:
			shape->segment = ( b2Segment ){ points[0], points[1] };
			shape->proxy = b2MakeProxy( points, 2, 0.0f );
			return true;
		case geometryChainSegment:
			shape->chainSegment = ( b2ChainSegment ){ points[0], { points[1], points[2] }, points[3], 0 };
			shape->proxy = b2MakeProxy( points + 1, 2, 0.0f );
			return true;
		default:
		{
			b2Hull hull = b2ComputeHull( points, count );
			if ( hull.count == 0 )
			{
				return false;
			}
			shape->polygon = b2MakePolygon( &hull, radius );
			shape->proxy = b2MakeProxy( shape->polygon.vertices, shape->polygon.count, radius );
			return true;
		}
	}
}

static b2Transform makeTransform( float x, float y, float cosine, float sine )
{
	return ( b2Transform ){ { x, y }, { cosine, sine } };
}

// Writes the mass, center x, y, and rotational inertia. Segments have no mass.
EMSCRIPTEN_KEEPALIVE float* computeGeometryMass( float density )
{
	GeometryShape shape;
	if ( !loadGeometryShape( 0, &shape ) )
	{
		return NULL;
	}
	b2MassData mass = { 0 };
	switch ( shape.kind )
	{
		case geometryCircle:
			mass = b2ComputeCircleMass( &shape.circle, density );
			break;
		case geometryCapsule:
			mass = b2ComputeCapsuleMass( &shape.capsule, density );
			break;
		case geometryPolygon:
			mass = b2ComputePolygonMass( &shape.polygon, density );
			break;
	}
	float* written = reserveOutput( 4 * sizeof( float ) );
	written[0] = mass.mass;
	written[1] = mass.center.x;
	written[2] = mass.center.y;
	written[3] = mass.rotationalInertia;
	return written;
}

static float* writeBox( b2AABB box )
{
	float* written = reserveOutput( 4 * sizeof( float ) );
	written[0] = box.lowerBound.x;
	written[1] = box.lowerBound.y;
	written[2] = box.upperBound.x;
	written[3] = box.upperBound.y;
	return written;
}

EMSCRIPTEN_KEEPALIVE float* computeGeometryBounds( float x, float y, float cosine, float sine )
{
	GeometryShape shape;
	if ( !loadGeometryShape( 0, &shape ) )
	{
		return NULL;
	}
	b2Transform transform = makeTransform( x, y, cosine, sine );
	switch ( shape.kind )
	{
		case geometryCircle:
			return writeBox( b2ComputeCircleBounds( &shape.circle, transform ) );
		case geometryCapsule:
			return writeBox( b2ComputeCapsuleBounds( &shape.capsule, transform ) );
		case geometrySegment:
			return writeBox( b2ComputeSegmentBounds( &shape.segment, transform ) );
		case geometryChainSegment:
			return writeBox( b2ComputeSegmentBounds( &shape.chainSegment.segment, transform ) );
		default:
			return writeBox( b2ComputePolygonBounds( &shape.polygon, transform ) );
	}
}

// Writes 1 when the point is inside the shape, else 0. Segments contain no points.
EMSCRIPTEN_KEEPALIVE int32_t* containsGeometryPoint( float x, float y, float cosine, float sine, float pointX,
													 float pointY )
{
	GeometryShape shape;
	if ( !loadGeometryShape( 0, &shape ) )
	{
		return NULL;
	}
	b2Vec2 point = b2InvTransformPoint( makeTransform( x, y, cosine, sine ), ( b2Vec2 ){ pointX, pointY } );
	int32_t* written = reserveOutput( sizeof( int32_t ) );
	switch ( shape.kind )
	{
		case geometryCircle:
			written[0] = b2PointInCircle( &shape.circle, point );
			break;
		case geometryCapsule:
			written[0] = b2PointInCapsule( &shape.capsule, point );
			break;
		case geometryPolygon:
			written[0] = b2PointInPolygon( &shape.polygon, point );
			break;
		default:
			written[0] = 0;
	}
	return written;
}

// Writes the hit flag, then the point x, y and normal x, y moved from `transform`'s frame into
// world space, then the fraction.
static float* writeCastOutput( b2CastOutput output, b2Transform transform )
{
	b2Vec2 point = b2TransformPoint( transform, output.point );
	b2Vec2 normal = b2RotateVector( transform.q, output.normal );
	float* written = reserveOutput( 6 * sizeof( float ) );
	written[0] = output.hit;
	written[1] = point.x;
	written[2] = point.y;
	written[3] = normal.x;
	written[4] = normal.y;
	written[5] = output.fraction;
	return written;
}

// A chain segment only blocks rays that come from its right side.
EMSCRIPTEN_KEEPALIVE float* castGeometryRay( float x, float y, float cosine, float sine, float originX, float originY,
											 float translationX, float translationY, float maxFraction )
{
	GeometryShape shape;
	if ( !loadGeometryShape( 0, &shape ) )
	{
		return NULL;
	}
	b2Transform transform = makeTransform( x, y, cosine, sine );
	b2RayCastInput ray = {
		b2InvTransformPoint( transform, ( b2Vec2 ){ originX, originY } ),
		b2InvRotateVector( transform.q, ( b2Vec2 ){ translationX, translationY } ),
		maxFraction,
	};
	switch ( shape.kind )
	{
		case geometryCircle:
			return writeCastOutput( b2CastRayCircle( &shape.circle, &ray ), transform );
		case geometryCapsule:
			return writeCastOutput( b2CastRayCapsule( &shape.capsule, &ray ), transform );
		case geometrySegment:
			return writeCastOutput( b2CastRaySegment( &shape.segment, &ray, false ), transform );
		case geometryChainSegment:
			return writeCastOutput( b2CastRaySegment( &shape.chainSegment.segment, &ray, true ), transform );
		default:
			return writeCastOutput( b2CastRayPolygon( &shape.polygon, &ray ), transform );
	}
}

// Sweeps the second shape along `translation` (in world space) toward the first.
EMSCRIPTEN_KEEPALIVE float* castGeometryShape( float xA, float yA, float cosineA, float sineA, float xB, float yB,
											   float cosineB, float sineB, float translationX, float translationY,
											   float maxFraction, bool canEncroach )
{
	GeometryShape shapeA;
	GeometryShape shapeB;
	if ( !loadGeometryShape( 0, &shapeA ) || !loadGeometryShape( 1, &shapeB ) )
	{
		return NULL;
	}
	b2Transform transformA = makeTransform( xA, yA, cosineA, sineA );
	b2ShapeCastPairInput cast = {
		shapeA.proxy,
		shapeB.proxy,
		b2InvMulTransforms( transformA, makeTransform( xB, yB, cosineB, sineB ) ),
		b2InvRotateVector( transformA.q, ( b2Vec2 ){ translationX, translationY } ),
		maxFraction,
		canEncroach,
	};
	return writeCastOutput( b2CastShape( &cast ), transformA );
}

// Writes the closest point on each shape x, y and the normal from A to B x, y in world space, then
// the distance and the iteration count.
EMSCRIPTEN_KEEPALIVE float* computeGeometryDistance( float xA, float yA, float cosineA, float sineA, float xB,
													 float yB, float cosineB, float sineB, bool useRadii )
{
	GeometryShape shapeA;
	GeometryShape shapeB;
	if ( !loadGeometryShape( 0, &shapeA ) || !loadGeometryShape( 1, &shapeB ) )
	{
		return NULL;
	}
	b2Transform transformA = makeTransform( xA, yA, cosineA, sineA );
	b2DistanceInput distanceInput = {
		shapeA.proxy,
		shapeB.proxy,
		b2InvMulTransforms( transformA, makeTransform( xB, yB, cosineB, sineB ) ),
		useRadii,
	};
	b2SimplexCache cache = { 0 };
	b2DistanceOutput distance = b2ComputeShapeDistance( &distanceInput, &cache, NULL, 0 );
	b2Vec2 pointA = b2TransformPoint( transformA, distance.pointA );
	b2Vec2 pointB = b2TransformPoint( transformA, distance.pointB );
	b2Vec2 normal = b2RotateVector( transformA.q, distance.normal );
	float* written = reserveOutput( 8 * sizeof( float ) );
	written[0] = pointA.x;
	written[1] = pointA.y;
	written[2] = pointB.x;
	written[3] = pointB.y;
	written[4] = normal.x;
	written[5] = normal.y;
	written[6] = distance.distance;
	written[7] = (float)distance.iterations;
	return written;
}

// Writes the closest point on each segment x, y, the fraction along each, and the squared distance.
EMSCRIPTEN_KEEPALIVE float* computeSegmentDistance( float point1X, float point1Y, float point2X, float point2Y,
													float point3X, float point3Y, float point4X, float point4Y )
{
	b2SegmentDistanceResult result =
		b2ComputeSegmentDistance( ( b2Vec2 ){ point1X, point1Y }, ( b2Vec2 ){ point2X, point2Y },
								  ( b2Vec2 ){ point3X, point3Y }, ( b2Vec2 ){ point4X, point4Y } );
	float* written = reserveOutput( 7 * sizeof( float ) );
	written[0] = result.closest1.x;
	written[1] = result.closest1.y;
	written[2] = result.closest2.x;
	written[3] = result.closest2.y;
	written[4] = result.fraction1;
	written[5] = result.fraction2;
	written[6] = result.distanceSquared;
	return written;
}

// Reads each shape's sweep after the two shapes: the local center x, y, the start center x, y, the
// end center x, y, then the start and end rotation cosine and sine. Writes the TOI state, the
// point x, y and normal x, y, then the fraction.
EMSCRIPTEN_KEEPALIVE float* computeTimeOfImpact( float maxFraction )
{
	GeometryShape shapeA;
	GeometryShape shapeB;
	if ( !loadGeometryShape( 0, &shapeA ) || !loadGeometryShape( 1, &shapeB ) )
	{
		return NULL;
	}
	float* sweeps = (float*)input + 2 * geometryShapeFloats;
	b2Sweep sweepA = {
		{ sweeps[0], sweeps[1] }, { sweeps[2], sweeps[3] }, { sweeps[4], sweeps[5] },
		{ sweeps[6], sweeps[7] }, { sweeps[8], sweeps[9] },
	};
	b2Sweep sweepB = {
		{ sweeps[10], sweeps[11] }, { sweeps[12], sweeps[13] }, { sweeps[14], sweeps[15] },
		{ sweeps[16], sweeps[17] }, { sweeps[18], sweeps[19] },
	};
	b2TOIInput toiInput = { shapeA.proxy, shapeB.proxy, sweepA, sweepB, maxFraction };
	b2TOIOutput toi = b2ComputeTimeOfImpact( &toiInput );
	float* written = reserveOutput( 6 * sizeof( float ) );
	written[0] = (float)toi.state;
	written[1] = toi.point.x;
	written[2] = toi.point.y;
	written[3] = toi.normal.x;
	written[4] = toi.normal.y;
	written[5] = toi.fraction;
	return written;
}

// Box2D only has a collide function for each pair in one order, so `collideOrdered` returns false
// for the other order and the caller swaps the shapes.
static bool collideOrdered( GeometryShape* shapeA, GeometryShape* shapeB, b2Transform transform,
							b2LocalManifold* manifold )
{
	b2SimplexCache cache = { 0 };
	int pair = shapeA->kind * 8 + shapeB->kind;
	switch ( pair )
	{
		case geometryCircle * 8 + geometryCircle:
			*manifold = b2CollideCircles( &shapeA->circle, &shapeB->circle, transform );
			return true;
		case geometryCapsule * 8 + geometryCircle:
			*manifold = b2CollideCapsuleAndCircle( &shapeA->capsule, &shapeB->circle, transform );
			return true;
		case geometrySegment * 8 + geometryCircle:
			*manifold = b2CollideSegmentAndCircle( &shapeA->segment, &shapeB->circle, transform );
			return true;
		case geometryPolygon * 8 + geometryCircle:
			*manifold = b2CollidePolygonAndCircle( &shapeA->polygon, &shapeB->circle, transform );
			return true;
		case geometryCapsule * 8 + geometryCapsule:
			*manifold = b2CollideCapsules( &shapeA->capsule, &shapeB->capsule, transform );
			return true;
		case geometrySegment * 8 + geometryCapsule:
			*manifold = b2CollideSegmentAndCapsule( &shapeA->segment, &shapeB->capsule, transform );
			return true;
		case geometryPolygon * 8 + geometryCapsule:
			*manifold = b2CollidePolygonAndCapsule( &shapeA->polygon, &shapeB->capsule, transform );
			return true;
		case geometryPolygon * 8 + geometryPolygon:
			*manifold = b2CollidePolygons( &shapeA->polygon, &shapeB->polygon, transform );
			return true;
		case geometrySegment * 8 + geometryPolygon:
			*manifold = b2CollideSegmentAndPolygon( &shapeA->segment, &shapeB->polygon, transform );
			return true;
		case geometryChainSegment * 8 + geometryCircle:
			*manifold = b2CollideChainSegmentAndCircle( &shapeA->chainSegment, &shapeB->circle, transform );
			return true;
		case geometryChainSegment * 8 + geometryCapsule:
			*manifold =
				b2CollideChainSegmentAndCapsule( &shapeA->chainSegment, &shapeB->capsule, transform, &cache );
			return true;
		case geometryChainSegment * 8 + geometryPolygon:
			*manifold =
				b2CollideChainSegmentAndPolygon( &shapeA->chainSegment, &shapeB->polygon, transform, &cache );
			return true;
		default:
			return false;
	}
}

static bool isLine( int kind )
{
	return kind == geometrySegment || kind == geometryChainSegment;
}

// Writes the point count, then the normal from A to B x, y in world space, then each point's x, y
// in world space, separation, and id. Two segments never touch.
EMSCRIPTEN_KEEPALIVE float* collideGeometry( float xA, float yA, float cosineA, float sineA, float xB, float yB,
											 float cosineB, float sineB )
{
	GeometryShape shapeA;
	GeometryShape shapeB;
	if ( !loadGeometryShape( 0, &shapeA ) || !loadGeometryShape( 1, &shapeB ) )
	{
		return NULL;
	}
	b2Transform transformA = makeTransform( xA, yA, cosineA, sineA );
	b2Transform transformB = makeTransform( xB, yB, cosineB, sineB );
	b2LocalManifold manifold = { 0 };
	b2Transform frame = transformA;
	float normalSign = 1.0f;
	if ( isLine( shapeA.kind ) && isLine( shapeB.kind ) )
	{
		manifold.pointCount = 0;
	}
	else if ( !collideOrdered( &shapeA, &shapeB, b2InvMulTransforms( transformA, transformB ), &manifold ) )
	{
		collideOrdered( &shapeB, &shapeA, b2InvMulTransforms( transformB, transformA ), &manifold );
		frame = transformB;
		normalSign = -1.0f;
	}
	b2Vec2 normal = b2MulSV( normalSign, b2RotateVector( frame.q, manifold.normal ) );
	float* written = reserveOutput( 11 * sizeof( float ) );
	written[0] = (float)manifold.pointCount;
	written[1] = normal.x;
	written[2] = normal.y;
	for ( int index = 0; index < manifold.pointCount; ++index )
	{
		b2Vec2 point = b2TransformPoint( frame, manifold.points[index].point );
		written[3 + index * 4] = point.x;
		written[4 + index * 4] = point.y;
		written[5 + index * 4] = manifold.points[index].separation;
		written[6 + index * 4] = manifold.points[index].id;
	}
	return written;
}

// Reads `pointCount` points from the input buffer and writes the hull's point count, then its
// points. The count is 0 when the points all lie on one line or there are too many of them.
EMSCRIPTEN_KEEPALIVE float* computeHull( int pointCount )
{
	b2Hull hull = b2ComputeHull( input, pointCount );
	float* written = reserveOutput( ( 1 + 2 * B2_MAX_POLYGON_VERTICES ) * sizeof( float ) );
	written[0] = (float)hull.count;
	memcpy( written + 1, hull.points, hull.count * sizeof( b2Vec2 ) );
	return written;
}

EMSCRIPTEN_KEEPALIVE b2DynamicTree* createTree( void )
{
	return b2CreateDynamicTree( 16 );
}

EMSCRIPTEN_KEEPALIVE void destroyTree( b2DynamicTree* tree )
{
	b2DestroyDynamicTree( tree );
}

static b2AABB makeBox( float lowerX, float lowerY, float upperX, float upperY )
{
	return ( b2AABB ){ { lowerX, lowerY }, { upperX, upperY } };
}

EMSCRIPTEN_KEEPALIVE int createTreeProxy( b2DynamicTree* tree, float lowerX, float lowerY, float upperX, float upperY,
										  uint64_t category )
{
	return b2CreateTreeProxy( tree, makeBox( lowerX, lowerY, upperX, upperY ), category, 0 );
}

EMSCRIPTEN_KEEPALIVE void destroyTreeProxy( b2DynamicTree* tree, int proxyId )
{
	b2DestroyTreeProxy( tree, proxyId );
}

EMSCRIPTEN_KEEPALIVE void moveTreeProxy( b2DynamicTree* tree, int proxyId, float lowerX, float lowerY, float upperX,
										 float upperY )
{
	b2DynamicTree_MoveProxy( tree, proxyId, makeBox( lowerX, lowerY, upperX, upperY ) );
}

EMSCRIPTEN_KEEPALIVE void setTreeProxyCategory( b2DynamicTree* tree, int proxyId, uint64_t category )
{
	b2DynamicTree_SetCategoryBits( tree, proxyId, category );
}

EMSCRIPTEN_KEEPALIVE uint64_t getTreeProxyCategory( b2DynamicTree* tree, int proxyId )
{
	return b2DynamicTree_GetCategoryBits( tree, proxyId );
}

EMSCRIPTEN_KEEPALIVE float* readTreeProxyBounds( b2DynamicTree* tree, int proxyId )
{
	return writeBox( b2DynamicTree_GetProxyBounds( tree, proxyId ) );
}

// Writes the height, area ratio, proxy count, and byte count, then the root bounds.
EMSCRIPTEN_KEEPALIVE float* readTreeStats( b2DynamicTree* tree )
{
	b2AABB root = b2DynamicTree_GetRootBounds( tree );
	float* written = reserveOutput( 8 * sizeof( float ) );
	written[0] = (float)b2DynamicTree_GetHeight( tree );
	written[1] = b2DynamicTree_GetAreaRatio( tree );
	written[2] = (float)b2DynamicTree_GetProxyCount( tree );
	written[3] = (float)b2DynamicTree_GetByteCount( tree );
	written[4] = root.lowerBound.x;
	written[5] = root.lowerBound.y;
	written[6] = root.upperBound.x;
	written[7] = root.upperBound.y;
	return written;
}

static int32_t* foundProxies = NULL;
static int foundProxyCount = 0;
static int foundProxyCapacity = 0;

static void findProxy( int proxyId )
{
	if ( foundProxyCount == foundProxyCapacity )
	{
		foundProxyCapacity = foundProxyCapacity == 0 ? 16 : foundProxyCapacity * 2;
		foundProxies = realloc( foundProxies, foundProxyCapacity * sizeof( int32_t ) );
	}
	foundProxies[foundProxyCount++] = proxyId;
}

static bool findOverlappingProxy( int proxyId, uint64_t userData, void* context )
{
	findProxy( proxyId );
	return true;
}

// Returning the input's own max fraction keeps the cast going without clipping it.
static float findRayProxy( const b2RayCastInput* rayInput, int proxyId, uint64_t userData, void* context )
{
	findProxy( proxyId );
	return rayInput->maxFraction;
}

static float findBoxProxy( const b2BoxCastInput* boxInput, int proxyId, uint64_t userData, void* context )
{
	findProxy( proxyId );
	return boxInput->maxFraction;
}

// Writes the found proxy count, then their ids.
static int32_t* writeFoundProxies( void )
{
	int32_t* written = reserveOutput( ( 1 + foundProxyCount ) * sizeof( int32_t ) );
	written[0] = foundProxyCount;
	memcpy( written + 1, foundProxies, foundProxyCount * sizeof( int32_t ) );
	foundProxyCount = 0;
	return written;
}

EMSCRIPTEN_KEEPALIVE int32_t* queryTree( b2DynamicTree* tree, float lowerX, float lowerY, float upperX, float upperY,
										 uint64_t mask )
{
	b2DynamicTree_OverlapAABB( tree, makeBox( lowerX, lowerY, upperX, upperY ), mask, findOverlappingProxy, NULL );
	return writeFoundProxies();
}

EMSCRIPTEN_KEEPALIVE int32_t* castTreeRay( b2DynamicTree* tree, float originX, float originY, float translationX,
										   float translationY, float maxFraction, uint64_t mask )
{
	b2RayCastInput ray = { { originX, originY }, { translationX, translationY }, maxFraction };
	b2DynamicTree_CastRay( tree, &ray, mask, findRayProxy, NULL );
	return writeFoundProxies();
}

EMSCRIPTEN_KEEPALIVE int32_t* castTreeBox( b2DynamicTree* tree, float lowerX, float lowerY, float upperX, float upperY,
										   float translationX, float translationY, float maxFraction, uint64_t mask )
{
	b2BoxCastInput box = {
		makeBox( lowerX, lowerY, upperX, upperY ),
		{ translationX, translationY },
		maxFraction,
	};
	b2DynamicTree_CastBox( tree, &box, mask, findBoxProxy, NULL );
	return writeFoundProxies();
}
