import { memo } from 'react';
import type { ObjectProps } from './ObjectShell';
import { Arrow } from './Arrow';
import { Ellipse } from './Ellipse';
import { Frame } from './Frame';
import { Image } from './Image';
import { Line } from './Line';
import { Rect } from './Rect';
import { Sticky } from './Sticky';
import { Stroke } from './Stroke';
import { Text } from './Text';

export const BoardObjectView = memo(function BoardObjectView({ object, editing, lifted }: ObjectProps) {
  switch (object.kind) {
    case 'stroke': return <Stroke object={object} editing={editing} lifted={lifted} />;
    case 'rect': return <Rect object={object} />;
    case 'ellipse': return <Ellipse object={object} />;
    case 'line': return <Line object={object} />;
    case 'arrow': return <Arrow object={object} />;
    case 'text': return <Text object={object} editing={editing} />;
    case 'sticky': return <Sticky object={object} editing={editing} lifted={lifted} />;
    case 'image': return <Image object={object} />;
    case 'frame': return <Frame object={object} />;
  }
});
