import packagedRFB from '@novnc/novnc';

// Bun/Vite expose Babel CommonJS defaults differently. Both resolve to the same pinned RFB.
const RFB =
  typeof packagedRFB === 'function'
    ? packagedRFB
    : (packagedRFB as unknown as { default: typeof packagedRFB }).default;
export default RFB;
