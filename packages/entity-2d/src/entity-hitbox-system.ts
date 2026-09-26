import {
    System as HitboxSystem,
    Response,
    type Response as Collision,
    type Body as Hitbox,
} from 'detect-collisions';
import {BaseEntity2d} from './entity.js';

export {System as HitboxSystem, type Response as Collision} from 'detect-collisions';

function extractEntityFromHitbox(hitbox: Hitbox) {
    return hitbox.userData instanceof BaseEntity2d ? hitbox.userData : undefined;
}

function hasCollisionTargets(entity: BaseEntity2d) {
    return (
        !!entity.entityDefinition.collidesWith?.collidesWithSelf ||
        entity.entityDefinition.collidesWithSet.size > 0
    );
}

function doesEntityCollideWith({
    entity,
    otherEntity,
}: Readonly<{
    entity: BaseEntity2d;
    otherEntity: BaseEntity2d;
}>) {
    return (
        (entity.entityDefinition.collidesWith?.collidesWithSelf &&
            entity.entityDefinition === otherEntity.entityDefinition) ||
        entity.entityDefinition.collidesWithSet.has(otherEntity.entityDefinition)
    );
}

function shouldCheckEntityCollision({
    firstEntity,
    secondEntity,
}: Readonly<{
    firstEntity: BaseEntity2d;
    secondEntity: BaseEntity2d;
}>) {
    return (
        doesEntityCollideWith({
            entity: firstEntity,
            otherEntity: secondEntity,
        }) ||
        doesEntityCollideWith({
            entity: secondEntity,
            otherEntity: firstEntity,
        })
    );
}

/**
 * Whether `entity` lists `otherEntity`'s class in its `collidesWith` definition.
 *
 * @category Internal
 */
export function shouldNotifyEntityOfCollision({
    entity,
    otherEntity,
}: Readonly<{
    entity: BaseEntity2d;
    otherEntity: BaseEntity2d;
}>) {
    return doesEntityCollideWith({
        entity,
        otherEntity,
    });
}

/**
 * Copies a collision with `a` and `b` swapped and the overlap vectors negated, so it reads from the
 * other body's point of view.
 *
 * @category Internal
 */
export function createReversedCollision(collision: Readonly<Collision>) {
    const reversedCollision = new Response();
    reversedCollision.a = collision.b;
    reversedCollision.aInB = collision.bInA;
    reversedCollision.b = collision.a;
    reversedCollision.bInA = collision.aInB;
    reversedCollision.overlap = collision.overlap;
    reversedCollision.overlapN.x = -collision.overlapN.x;
    reversedCollision.overlapN.y = -collision.overlapN.y;
    reversedCollision.overlapV.x = -collision.overlapV.x;
    reversedCollision.overlapV.y = -collision.overlapV.y;

    return reversedCollision;
}

function hasAlreadyCheckedHitboxPair({
    checkedHitboxPairs,
    firstHitbox,
    secondHitbox,
}: Readonly<{
    checkedHitboxPairs: WeakMap<Hitbox, WeakSet<Hitbox>>;
    firstHitbox: Hitbox;
    secondHitbox: Hitbox;
}>) {
    return (
        checkedHitboxPairs.get(firstHitbox)?.has(secondHitbox) ||
        checkedHitboxPairs.get(secondHitbox)?.has(firstHitbox)
    );
}

function markHitboxPairAsChecked({
    checkedHitboxPairs,
    firstHitbox,
    secondHitbox,
}: Readonly<{
    checkedHitboxPairs: WeakMap<Hitbox, WeakSet<Hitbox>>;
    firstHitbox: Hitbox;
    secondHitbox: Hitbox;
}>) {
    const firstHitboxPairs = checkedHitboxPairs.get(firstHitbox);

    if (firstHitboxPairs) {
        firstHitboxPairs.add(secondHitbox);
    } else {
        checkedHitboxPairs.set(firstHitbox, new WeakSet([secondHitbox]));
    }
}

/**
 * A collision system that skips pairs no entity observes before running SAT collision checks.
 *
 * @category Internal
 */
export class EntityHitboxSystem extends HitboxSystem {
    protected checkedHitboxPairs: WeakMap<Hitbox, WeakSet<Hitbox>> | undefined;

    public override checkAll(
        ...[
            callback,
            response,
        ]: Parameters<HitboxSystem['checkAll']>
    ) {
        const previousCheckedHitboxPairs = this.checkedHitboxPairs;
        this.checkedHitboxPairs = new WeakMap();

        try {
            return this.all().some((hitbox: Hitbox) => {
                const entity = extractEntityFromHitbox(hitbox);

                return (
                    (!entity || hasCollisionTargets(entity)) &&
                    this.checkOne(hitbox, callback, response)
                );
            });
        } finally {
            this.checkedHitboxPairs = previousCheckedHitboxPairs;
        }
    }

    public override checkOne(
        ...[
            hitbox,
            callback,
            response,
        ]: Parameters<HitboxSystem['checkOne']>
    ) {
        const entity = extractEntityFromHitbox(hitbox);

        if (entity && !hasCollisionTargets(entity)) {
            return false;
        }

        return super.checkOne(hitbox, callback, response);
    }

    public override checkCollision(...hitboxes: Parameters<HitboxSystem['checkCollision']>) {
        const [
            firstHitbox,
            secondHitbox,
        ] = hitboxes;
        const checkedHitboxPairs = this.checkedHitboxPairs;

        if (
            checkedHitboxPairs &&
            hasAlreadyCheckedHitboxPair({
                checkedHitboxPairs,
                firstHitbox,
                secondHitbox,
            })
        ) {
            return false;
        }

        if (checkedHitboxPairs) {
            markHitboxPairAsChecked({
                checkedHitboxPairs,
                firstHitbox,
                secondHitbox,
            });
        }

        const firstEntity = extractEntityFromHitbox(firstHitbox);
        const secondEntity = extractEntityFromHitbox(secondHitbox);

        if (
            firstEntity &&
            secondEntity &&
            !shouldCheckEntityCollision({
                firstEntity,
                secondEntity,
            })
        ) {
            return false;
        }

        return super.checkCollision(...hitboxes);
    }
}
