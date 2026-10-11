# theme

The design tokens and themes. `px-tokens.css` defines every `--px-*`
colour, size, radius and motion value; `px-base.css`, `px-controls.css`,
`px-fonts.css`, `px-motion.css` apply them; `themes/` holds the light and
dark themes; `pxAppearance.ts` and `systemMode.ts` follow the user's
appearance settings; `themeApply.ts` switches themes at runtime.

May import: `platform`, `ui`.
