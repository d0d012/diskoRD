import { memo } from 'react';
import type { RectObject } from '../../contract';
import { ObjectShell } from './ObjectShell';
import type { ObjectProps } from './ObjectShell';

export const Rect = memo(function Rect(props: ObjectProps<RectObject>) {
  return <ObjectShell {...props}><svg aria-hidden="true"><rect data-wb-shape="" /></svg></ObjectShell>;
});
