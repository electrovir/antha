import {type PartialWithUndefined} from '@augment-vir/common';
import {type EventExtraContext, type EventTags} from 'sentry-vir';

export type BaseAnthaLogger = {
    error: AnthaLog;
    info: AnthaLog;
    warning: AnthaLog;
};

export type AnthaLogger = BaseAnthaLogger & {
    if: (condition: boolean) => BaseAnthaLogger;
};

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
