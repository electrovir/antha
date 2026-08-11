import {type AnthaEngine, type AnthaUi} from '@antha/engine';
import {type RequireExactlyOne} from '@augment-vir/common';
import {type FullDate} from 'date-vir';
import {type DeclarativeElementDefinition} from 'element-vir';

export type AnthaDemo = {
    /** The user-facing name of this demo. Showed in the demo picker. */
    demoName: string;
    /** The id used to access this demo in the browser's URL path. Should be URL safe. */
    demoPathId: string;
    /** The date on which this demo was created. This affects sort order in the demo pick list. */
    demoSortDate: Readonly<FullDate>;
} & RequireExactlyOne<{
    /** The element to render for this demo. This should require no inputs. */
    element: DeclarativeElementDefinition;
    /**
     * The engine to use for this demo. This will be automatically inserted into a {@link AnthaUi}
     * instance.
     */
    engine: () => AnthaEngine;
}>;
