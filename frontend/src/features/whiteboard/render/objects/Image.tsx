import { memo } from 'react';
import type { ImageObject } from '../../contract';
import { ObjectShell } from './ObjectShell';
import type { ObjectProps } from './ObjectShell';

export const Image = memo(function Image(props: ObjectProps<ImageObject>) {
  return <ObjectShell {...props}><div className="wb-render-image-crop"><img alt="Board image" draggable={false} /></div></ObjectShell>;
});
