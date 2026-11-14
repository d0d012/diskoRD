import { memo } from 'react';
import type { EllipseObject } from '../../contract';
import { ObjectShell } from './ObjectShell';
import type { ObjectProps } from './ObjectShell';

export const Ellipse = memo(function Ellipse(props: ObjectProps<EllipseObject>) {
  return <ObjectShell {...props}><svg aria-hidden="true"><ellipse data-wb-shape="" /></svg></ObjectShell>;
});
