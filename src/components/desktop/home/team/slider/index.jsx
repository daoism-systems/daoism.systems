import React, { useRef, useCallback, useEffect } from "react";
import { Swiper, SwiperSlide } from "swiper/react";

import Slide from "./slide";

import "swiper/css";
import "swiper/css/pagination";

import styles from "./index.module.scss";

import { Autoplay, Navigation } from "swiper";

const iconArrow = (
  <svg
    width="18"
    height="11"
    viewBox="0 0 18 11"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M9.00008 0.585938L17.7072 9.29304L16.293 10.7073L9.00008 3.41436L1.70718 10.7073L0.292969 9.29304L9.00008 0.585938Z"
      fill="white"
    />
  </svg>
);

const sliders = [
  {
    imageUrl: "/team/00.png",
    name: "Arseny",
    position: "Co-founder & CEO",
    twitter: "https://twitter.com/arseneeth",
    github: "https://github.com/arseneeth",
    tab: "management",
  },
  {
    imageUrl: "/team/9.jpg",
    name: "Ilja",
    position: "Сo-founder, СFO & COO",
    linkedin: "https://www.linkedin.com/in/isolomonovs/",
    twitter: "https://twitter.com/isolomonovs",
    tab: "management",
  },
  // {
  //   imageUrl: "/team/10.jpg",
  //   name: "Benjamin",
  //   position: "CTO",
  //   twitter: "https://twitter.com/bxmmm",
  //   github: "https://github.com/bxmmm1",
  //   tab: "development",
  // },
  {
    imageUrl: "/team/2.jpg",
    name: "Aleksandra",
    position: "Project Manager",
    linkedin: "https://www.linkedin.com/in/itsmeesasha",
    twitter: "https://twitter.com/nekamenskaya",
    tab: "management",
  },
    {
    imageUrl: "/team/maria_wbg.jpg",
    name: "Maria",
    position: "Community Manager",
    twitter: "https://twitter.com/mabel_felixm",
    tab: "management",
  },
    {
    imageUrl: "/team/11.jpg",
    name: "Jeein",
    position: "Communications Lead",
    linkedin: "https://www.linkedin.com/in/jeein-shin",
    twitter: "https://twitter.com/jeein0",
    github: "https://github.com/j-shn",
    tab: "research",
  },
];

const Slider = ({ activeTab }) => {
  const sliderRef = useRef(null);

  const handlePrev = useCallback(() => {
    if (!sliderRef.current) return;
    sliderRef.current.swiper.slidePrev();
  }, []);

  const handleNext = useCallback(() => {
    if (!sliderRef.current) return;
    sliderRef.current.swiper.slideNext();
  }, []);

  useEffect(() => {
    if (activeTab) {
      console.log(activeTab, sliderRef.current.swiper.activeIndex);
      sliderRef.current.swiper.slideToLoop(activeTab);
      console.log(activeTab, sliderRef.current.swiper.activeIndex);
      sliderRef.current.swiper.updateSize();
      sliderRef.current.swiper.updateSlides();
      sliderRef.current.swiper.updateProgress();
      sliderRef.current.swiper.updateSlidesClasses();
    }
  }, [activeTab]);

  return (
    <Swiper
      ref={sliderRef}
      slideToClickedSlide={true}
      modules={[Autoplay, Navigation]}
      direction={"vertical"}
      autoHeight={true}
      edgeSwipeThreshold={100}
      slidesPerView={3}
      loop={true}
      speed={1000}
      className={styles.slider}
    >
      {sliders.map((slide, id) => (
        <SwiperSlide key={id}>
          <Slide
            imageUrl={slide.imageUrl}
            name={slide.name}
            position={slide.position}
            twitter={slide.twitter}
            linkedin={slide.linkedin}
            github={slide.github}
          />
        </SwiperSlide>
      ))}

      <div className={styles.arrows}>
        <button type={"button"} onClick={handlePrev}>
          {iconArrow}
        </button>
        <button type={"button"} onClick={handleNext}>
          {iconArrow}
        </button>
      </div>
    </Swiper>
  );
};

export default Slider;
