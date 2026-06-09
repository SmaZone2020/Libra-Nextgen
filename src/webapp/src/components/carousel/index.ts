import {
  CarouselContent,
  CarouselDots,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  CarouselRoot,
  CarouselThumbnail,
  CarouselThumbnails,
} from './carousel';
export { carouselVariants } from './carousel.styles';
export { useCarousel } from './carousel-context';

export const Carousel = Object.assign(CarouselRoot, {
  Content: CarouselContent,
  Dots: CarouselDots,
  Item: CarouselItem,
  Next: CarouselNext,
  Previous: CarouselPrevious,
  Root: CarouselRoot,
  Thumbnail: CarouselThumbnail,
  Thumbnails: CarouselThumbnails,
});

export {
  CarouselContent,
  CarouselDots,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  CarouselRoot,
  CarouselThumbnail,
  CarouselThumbnails,
};
