// pdf.js worker entry: polyfills first (module imports evaluate in order), then the real worker.
import './pdf.polyfills.mjs';
import './pdf.worker.min.mjs';
