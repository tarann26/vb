// The one place a control that lives INSIDE the hero collage is built.
//
// EditMode.tsx's capture-phase click guard cancels every click inside the real
// page that it does not explicitly recognise (see its own `handleCaptureClick`
// for the four carve-outs and why each exists). Its fourth carve-out is
// `data-collage-control`, and between the split-tree rewrite and Plan 9 Task 4
// that carve-out had NO producer at all: the component that used to set the
// marker (CollageTile.tsx) was deleted along with the grid machinery, while
// the guard's own comment still named it. A control added on the strength of
// that sentence would have been silently inert -- the exact class of failure
// this project has shipped before, and a Plan 9 gate review found it sitting
// here as dead code.
//
// So the marker is not something a call site sets; it is something this
// component cannot omit. Its own file, rather than a private function inside
// CollageEditor.tsx, because `react-refresh/only-export-components` warns on a
// module that exports both a component and a hook -- and this project runs
// eslint at zero warnings. (Constants are exempt under the rule's
// `allowConstantExport`, which is why the attribute name may live here beside
// it.)
import type { CSSProperties, ReactNode } from 'react';

export const COLLAGE_CONTROL_ATTR = 'data-collage-control';

export interface CollageControlButtonProps {
  // Always given, never derived from `children`: several of these render a
  // two-word label inside a photo box, and the sentence a screen reader needs
  // ("Swap the selected photo into this box") is longer than the two words
  // that fit on screen.
  label: string;
  onActivate: () => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export default function CollageControlButton({
  label,
  onActivate,
  disabled,
  className,
  style,
  children,
}: CollageControlButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={className}
      style={style}
      onClick={onActivate}
      // Spread rather than written as a JSX attribute so the ONE spelling of
      // this attribute name (the constant above, which the guard also
      // imports through EditMode's own tests) is the only spelling anywhere.
      {...{ [COLLAGE_CONTROL_ATTR]: '' }}
    >
      {children}
    </button>
  );
}
