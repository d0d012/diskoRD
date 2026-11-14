import { memo } from 'react';
import type { FrameObject } from '../../contract';
import { ObjectShell } from './ObjectShell';
import type { ObjectProps } from './ObjectShell';

export const Frame = memo(function Frame(props: ObjectProps<FrameObject>) {
  return <ObjectShell {...props}>
    <div className="wb-root__frame wb-render-frame-border" />
    <div className="wb-root__frame-label wb-render-frame-label" data-wb-frame-label={props.object.id}>
      <span className="wb-root__frame-chip" aria-hidden="true">F</span><span data-wb-frame-title="" />
    </div>
  </ObjectShell>;
});
