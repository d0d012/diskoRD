import { memo } from 'react';
import type { StrokeObject } from '../../contract';
import { ObjectShell } from './ObjectShell';
import type { ObjectProps } from './ObjectShell';

export const Stroke = memo(function Stroke(props: ObjectProps<StrokeObject>) {
  return <ObjectShell {...props}><svg aria-hidden="true"><path /></svg></ObjectShell>;
});
