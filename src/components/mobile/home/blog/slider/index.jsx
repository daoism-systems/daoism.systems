import * as React from "react";
import Link from "next/link";
import { Swiper, SwiperSlide } from "swiper/react";

import Slide from "./slide";

import "swiper/css";
import "swiper/css/pagination";

import styles from "./index.module.scss";

import { Autoplay, Mousewheel } from "swiper";

const sliders = [
  {
    id: 1,
    title: "Modular Futures for Custom DAO Development",
    date: "16. 11. 2022",
    image: "/article2.jpeg",
    link: "https://mirror.xyz/0013700.eth/NTVMbFymSqWw62OOAkAel43uxuLOgnNB4jK1n-OZnJ8",
  },
  {
    id: 2,
    title: "Daoism Systems Manifesto",
    date: "",
    image: "/manifesto.jpg",
    link: "https://mirror.xyz/0013700.eth/Oc9O1gVt6OJ7pF_KH3vXo8hZVQt6ecJ6-le7NzhEHKs",
  },
  {
    id: 3,
    title: "DoinGud: Building a DeSI Protocol with Multilevel Governance",
    date: "28. 11. 2022",
    image: "/article3.jpeg",
    link: "https://mirror.xyz/0013700.eth/zWJyiODvgveaw32h0jRRQuebeSVoJ-gEoj42essfQUk",
  },
  {
    id: 4,
    title: "Summoning a Decentralised Safe Registry",
    date: "30. 11. 2022",
    image: "/article4.jpeg",
    link: "https://mirror.xyz/0013700.eth/HAxUoydAAvcEnygRvGsqecAhC1XcfcQlAy6x_htY3ZQ",
  }
];

const Slider = () => {
  return (
    <div className={styles.sliderBox}>
      {/* <div className={styles.categoryList}>
        <ul>
          <li>
            <button type={"button"}>All</button>
          </li>
          <li>
            <button type={"button"}>innovation</button>
          </li>
          <li>
            <button type={"button"}>Work</button>
          </li>
        </ul>
      </div> */}

      <Swiper
        modules={[Autoplay, Mousewheel]}
        slidesPerView={"auto"}
        centeredSlides={true}
        initialSlide={0}
        // forceToAxis={true}
        // mousewheel={true}
        // releaseOnEdges={true}
        loop={false}
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
            />
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
};

export default Slider;
