# EMOS Design Tokens

All design tokens live in `tokens.css`. This is the single source of
truth for colors, spacing, typography, borders, and radii.

## Usage

In CSS:
```css
.my-component {
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  padding: var(--space-lg);
  border-radius: var(--radius-md);
}
```

In Tailwind:
```tsx
<div className="bg-bg-primary text-text-primary p-emos-lg rounded-emos-md">
```

## Rules

1. **Never hardcode colors** in components. Use tokens.
2. **Never use arbitrary sizes** like `text-[9px]`. Use the scale.
3. **Two weights only**: 400 regular, 500 medium.
4. **Sentence case** everywhere.
5. **Numbers always in mono** with `font-mono` class.

See `EMOS_TOKENS_PROMPT.md` for the full spec.
