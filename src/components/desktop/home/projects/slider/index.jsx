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
     // title: "SupremeDAO",
     date: "10. 05.2023",
     image: "/supremeDAO.jpeg",
     link: "https://twitter.com/supreme_dao",
     // type: "Project",
   },
  {
    id: 2,
    date: "25. 04. 2021",
    image: "/nindao.jpg",
    link: "https://nindao.xyz/",
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
