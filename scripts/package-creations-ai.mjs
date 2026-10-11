// package-creations-ai.mjs — packages the creations-ai extension as a .plx file.
//
// Usage: node scripts/package-creations-ai.mjs
//
// Output: ext/creations-ai/creations-ai.plx

import { packageExtension } from './package-extension.mjs';

packageExtension('creations-ai');
