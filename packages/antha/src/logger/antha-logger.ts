import {type PartialWithUndefined} from '@augment-vir/common';
import {type EventExtraContext, type EventTags} from 'sentry-vir';

/**
 * Base logger methods.
 *
 * @category Internal
 */
export type BaseAnthaLogger = {
    error: AnthaLog;
    info: AnthaLog;
    warning: AnthaLog;
};

/**
 * The customizable logger used by Antha engine and its pre-built mods.
 *
 * @category Logger
 */
export type AnthaLogger = BaseAnthaLogger & {
    /** Only logs if the given condition is true. */
    if: (condition: boolean) => BaseAnthaLogger;
};

/**
 * An individual log method.
 *
 * @category Internal
 */
export type AnthaLog = (
    this: void,
    message: string | Error,
    context?:
        | PartialWithUndefined<{
              context: EventExtraContext;
              tags: EventTags;
          }>
        | undefined,
) => void;
