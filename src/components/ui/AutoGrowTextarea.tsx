import { forwardRef, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/**
 * A textarea that grows to fit its content instead of scrolling inside a
 * fixed height, so long text is never hidden. Works for both controlled
 * (`value`) and uncontrolled (`defaultValue`) textareas: it resizes on every
 * render (covering controlled value changes and mount) and on `input`
 * (covering uncontrolled typing).
 *
 * Pass `rows` for the initial/minimum height; the box only ever grows from
 * there. Callers' `style` is preserved, but `resize` is forced off — a manual
 * drag handle defeats the purpose. `overflow` is normally forced hidden too,
 * since an inner scrollbar is exactly what this exists to avoid; a caller that
 * caps the growth with `style.maxHeight` gets `overflow: auto` instead, so text
 * past the cap is still reachable.
 *
 * Forwards its ref: a caller that needs the caret (the review composer's
 * `@` picker) or wants to focus the box gets the element itself.
 */
export const AutoGrowTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function AutoGrowTextarea({ onInput, style, ...rest }, forwardedRef) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const fit = (el: HTMLTextAreaElement) => {
    // Collapse first so shrinking (deleting text) is measured correctly, then
    // grow to the content's scroll height. scrollHeight is content+padding and
    // excludes the border; under box-sizing:border-box the height property
    // *includes* the border, so add it back or the last line is clipped ~2px.
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const border =
      cs.boxSizing === 'border-box'
        ? parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
        : 0;
    el.style.height = `${el.scrollHeight + border}px`;
  };

  useLayoutEffect(() => {
    if (ref.current) fit(ref.current);
  });

  return (
    <textarea
      ref={el => {
        ref.current = el;
        if (typeof forwardedRef === 'function') forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      }}
      onInput={e => {
        fit(e.currentTarget);
        onInput?.(e);
      }}
      style={{ ...style, resize: 'none', overflow: style?.maxHeight != null ? 'auto' : 'hidden' }}
      {...rest}
    />
  );
});
