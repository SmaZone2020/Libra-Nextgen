import type { VariantProps } from 'tailwind-variants';
import { tv } from 'tailwind-variants';

export const carouselVariants = tv({
  defaultVariants: {
    type: 'in-place',
  },
  slots: {
    base: 'carousel',
    content: 'carousel__content',
    dot: 'carousel__dot',
    dots: 'carousel__dots',
    item: 'carousel__item',
    next: 'carousel__next',
    previous: 'carousel__previous',
    thumbnail: 'carousel__thumbnail',
    thumbnails: 'carousel__thumbnails',
    viewport: 'carousel__viewport',
    viewportWrapper: 'carousel__viewport-wrapper',
  },
  variants: {
    type: {
      'in-place': {
        base: 'carousel--in-place',
        next: 'carousel__next--in-place',
        previous: 'carousel__previous--in-place',
      },
      miniatures: {
        base: 'carousel--miniatures',
        next: 'carousel__next--miniatures',
        previous: 'carousel__previous--miniatures',
        thumbnails: 'carousel__thumbnails--miniatures',
      },
      modal: {
        base: 'carousel--modal',
        next: 'carousel__next--modal',
        previous: 'carousel__previous--modal',
      },
    },
  },
});

export type CarouselVariants = VariantProps<typeof carouselVariants>;
