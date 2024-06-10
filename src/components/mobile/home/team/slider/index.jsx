import React, { useRef, useEffect } from "react";
import { Swiper, SwiperSlide } from "swiper/react";

import Slide from "./slide";

import "swiper/css";
import "swiper/css/pagination";

import styles from "./index.module.scss";

import { Autoplay } from "swiper";

const sliders = [
  {
    imageUrl: "/team/1.jpg",
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
      modules={[Autoplay]}
      direction={"vertical"}
      slidesPerView={3}
      autoHeight={false}
      loop={false}
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
    </Swiper>
  );
};

export default Slider;
