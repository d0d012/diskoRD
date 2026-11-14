import { memo } from 'react';
import type { StickyObject } from '../../contract';
import { ObjectShell } from './ObjectShell';
import type { ObjectProps } from './ObjectShell';

export const Sticky = memo(function Sticky(props: ObjectProps<StickyObject>) {
  return <ObjectShell {...props}><div className="wb-root__sticky wb-render-sticky-note"><div className="wb-render-sticky-text" data-wb-text="" /><div className="wb-render-sticky-reactions" data-wb-sticky-reactions="" /></div></ObjectShell>;
});
