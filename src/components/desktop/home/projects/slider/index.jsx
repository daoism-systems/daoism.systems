import * as React from "react";
import Link from "next/link";
import { Swiper, SwiperSlide } from "swiper/react";

import Slide from "./slide";

import "swiper/css";
import "swiper/css/effect-coverflow";
import "swiper/css/pagination";

import styles from "./index.module.scss";

import { Autoplay, Mousewheel, Pagination, EffectCoverflow } from "swiper";

const sliders = [
  {
    id: 1,
    // title: "Everstrat",
    date: "03. 07. 2026",
    image: "/everstrat.png",
    link: "https://www.everstrat.xyz",
    // type: "Project",
  },
];

const Slider = ({ scroll }) => {
  return (
    <div className={styles.sliderBox}>
      <Swiper
        grabCursor={true}
        effect={"coverflow"}
        coverflowEffect={{
          rotate: -30,
          stretch: 0,
          depth: 600,
          modifier: 2,
          slideShadows: false,
        }}
        modules={[Autoplay, Mousewheel, Pagination, EffectCoverflow]}
        pagination={{ clickable: true }}
        slidesPerView={2}
        slideToClickedSlide={true}
        centeredSlides={true}
        loop={true}
        speed={1000}
        autoHeight={true}
        className={styles.slider}
      >
        {sliders.map((slide, id) => (
          <SwiperSlide key={id}>
            <Slide
              title={slide.title}
              date={slide.date}
              imageUrl={slide.image}
              link={slide.link}
              scroll={scroll}
              type={slide.type}
            />
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
};

export default Slider;
