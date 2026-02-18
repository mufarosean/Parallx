// structuralInvariantGuard.ts — extension wrapper for structural invariants

import { Extension } from '@tiptap/core';
import { structuralInvariantPlugin } from '../plugins/structuralInvariantPlugin.js';

export const StructuralInvariantGuard = Extension.create({
  name: 'structuralInvariantGuard',
  priority: 1000,

  addProseMirrorPlugins() {
    return [structuralInvariantPlugin()];
  },
});
