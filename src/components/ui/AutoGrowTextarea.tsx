import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/**
 * A textarea that grows to fit its content instead of scrolling inside a
 * fixed height, so long text is never hidden. Works for both controlled
 * (`value`) and uncontrolled (`defaultValue`) textareas: it resizes on every
 * render (covering controlled value changes and mount) and on `input`
 * (covering uncontrolled typing).
 *
 * Pass `rows` for the initial/minimum height; the box only ever grows from
 * there. Callers' `style` is preserved, but `resize`/`overflow` are forced —
 * a manual resize handle or an inner scrollbar would defeat the purpose.
 */
export function AutoGrowTextarea({
  onInput,
  style,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
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
      ref={ref}
      onInput={e => {
        fit(e.currentTarget);
        onInput?.(e);
      }}
      style={{ ...style, resize: 'none', overflow: 'hidden' }}
      {...rest}
    />
  );
}
