import { memo } from 'react';
import type { ArrowObject } from '../../contract';
import { ObjectShell } from './ObjectShell';
import type { ObjectProps } from './ObjectShell';

export const Arrow = memo(function Arrow(props: ObjectProps<ArrowObject>) {
  return <ObjectShell {...props}><svg aria-hidden="true"><line /><path /></svg></ObjectShell>;
});
