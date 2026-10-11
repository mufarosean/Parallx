// package-media-organizer.mjs — packages the media-organizer extension as a .plx file.
//
// Usage: node scripts/package-media-organizer.mjs
//
// Output: ext/media-organizer/media-organizer.plx

import { packageExtension } from './package-extension.mjs';

packageExtension('media-organizer');
