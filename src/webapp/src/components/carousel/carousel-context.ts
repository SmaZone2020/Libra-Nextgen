'use client';

import { createContext, useContext } from 'react';
import type { EmblaCarouselType } from 'embla-carousel';
import type { carouselVariants } from './carousel.styles';

export type CarouselContextValue = {
  api: EmblaCarouselType | undefined;
  canScrollNext: boolean;
  canScrollPrev: boolean;
  emblaRef: ((node: HTMLDivElement | null) => void) | null;
  scrollNext: () => void;
  scrollPrev: () => void;
  scrollSnapCount: number;
  scrollTo: (index: number) => void;
  selectedIndex: number;
  setViewportWrapper: (node: HTMLDivElement | null) => void;
  slots?: ReturnType<typeof carouselVariants>;
  type: 'in-place' | 'modal' | 'miniatures';
  viewportWrapper: HTMLDivElement | null;
};

export const CarouselContext = createContext<CarouselContextValue>({
  api: undefined,
  canScrollNext: false,
  canScrollPrev: false,
  emblaRef: null,
  scrollNext: () => {},
  scrollPrev: () => {},
  scrollSnapCount: 0,
  scrollTo: () => {},
  selectedIndex: 0,
  setViewportWrapper: () => {},
  type: 'in-place',
  viewportWrapper: null,
});

export const useCarousel = (): CarouselContextValue =>
  useContext(CarouselContext);
