import { RatingItem, RatingRoot } from './rating';
export { RatingStarIcon } from './rating';
export { ratingVariants } from './rating.styles';

const Rating = Object.assign(RatingRoot, {
  Item: RatingItem,
  Root: RatingRoot,
});

export { Rating, RatingItem, RatingRoot };
export type {
  RatingItemProps,
  RatingItemRenderProps,
  RatingRootProps as RatingProps,
  RatingRootProps,
} from './rating';
export type { RatingVariants } from './rating.styles';
