import { memo } from 'react';
import type { LineObject } from '../../contract';
import { ObjectShell } from './ObjectShell';
import type { ObjectProps } from './ObjectShell';

export const Line = memo(function Line(props: ObjectProps<LineObject>) {
  return <ObjectShell {...props}><svg aria-hidden="true"><line /></svg></ObjectShell>;
});
