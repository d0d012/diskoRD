import { memo } from 'react';
import type { TextObject } from '../../contract';
import { ObjectShell } from './ObjectShell';
import type { ObjectProps } from './ObjectShell';

export const Text = memo(function Text(props: ObjectProps<TextObject>) {
  return <ObjectShell {...props}><div className="wb-render-text" data-wb-text="" /></ObjectShell>;
});
