import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { BoardObject } from '../../contract';
import { paintObject } from './presentation';

export interface ObjectProps<T extends BoardObject = BoardObject> {
  object: T;
  editing?: boolean;
  lifted?: boolean;
}
interface ObjectShellProps extends ObjectProps { children: ReactNode }

export function ObjectShell({ object, editing = false, lifted = false, children }: ObjectShellProps) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (root.current) paintObject(root.current, object, editing, lifted);
  }, [object, editing, lifted]);
  return <div ref={root} className={`wb-render-object wb-render-${object.kind}`} data-wb-object-id={object.id} data-wb-kind={object.kind}>
    <div className="wb-render-visual wb-root__object-enter">{children}</div>
  </div>;
}
