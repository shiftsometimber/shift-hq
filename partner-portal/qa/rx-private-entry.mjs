import {createSstrxPortal} from '../sstrx-worker.mjs';
import {createQaAccessBoundary} from './access-boundary.mjs';
import {QA_RX_ORIGIN} from './access-config.mjs';

// Isolated target entry only. Production gateway routing remains unchanged.
export default createQaAccessBoundary(createSstrxPortal(QA_RX_ORIGIN));
