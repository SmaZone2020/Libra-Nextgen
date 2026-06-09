import { SegmentItem, SegmentRoot, SegmentSeparator } from './segment';
export { segmentVariants } from './segment.styles';

const Segment = Object.assign(SegmentRoot, {
  Item: SegmentItem,
  Root: SegmentRoot,
  Separator: SegmentSeparator,
});

export { Segment, SegmentItem, SegmentRoot, SegmentSeparator };
export type {
  SegmentItemProps,
  SegmentRootProps as SegmentProps,
  SegmentRootProps,
  SegmentSeparatorProps,
} from './segment';
export type { SegmentVariants } from './segment.styles';
