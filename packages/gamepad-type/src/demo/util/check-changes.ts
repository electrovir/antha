import {check} from '@augment-vir/assert';
import {filterObject} from '@augment-vir/common';
import {
    type GamepadLayout,
    type GamepadModelMap,
    defaultGamepadLayouts,
    defaultGamepadModelMap,
} from '../../index.js';

export type ChangedEntries = {
    layouts: ReadonlyArray<Readonly<GamepadLayout>>;
    models: Readonly<GamepadModelMap>;
};

export function extractNewChanges(
    {layouts, models}: Readonly<ChangedEntries>,
    lastSubmitted: Readonly<ChangedEntries> | undefined,
): Readonly<ChangedEntries> {
    const changedLayouts = layouts.filter((layout) => {
        const matchesDefault = defaultGamepadLayouts.some((defaultLayout) => {
            return check.jsonEquals(defaultLayout, layout);
        });
        const matchesSubmitted: boolean = lastSubmitted
            ? lastSubmitted.layouts.some((submittedLayout) => {
                  return check.jsonEquals(submittedLayout, layout);
              })
            : false;
        return !matchesDefault && !matchesSubmitted;
    });

    const changedModels = filterObject(models, (deviceName, newModel) => {
        const newFromDefault =
            !(deviceName in defaultGamepadModelMap) ||
            defaultGamepadModelMap[deviceName] !== newModel;
        const newFromSubmitted = lastSubmitted
            ? !(deviceName in lastSubmitted.models) || lastSubmitted.models[deviceName] !== newModel
            : true;

        return newFromSubmitted && newFromDefault;
    }) as GamepadModelMap;

    return {
        layouts: changedLayouts,
        models: changedModels,
    };
}
