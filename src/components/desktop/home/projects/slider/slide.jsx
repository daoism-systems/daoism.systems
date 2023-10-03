import * as React from "react";
import Image from "next/image";

import styles from "./slide.module.scss";

const Slide = ({ title, date, imageUrl, link, scroll, type }) => {
  return (
    <>
      {link === "#" ? (
        <div
          onClick={() => (scroll.scrollTop = 0.92 * scroll.scrollHeight)}
          className={styles.slideBox}
        >
          <div className={styles.slideImage}>
            <Image src={imageUrl} alt={title} quality={100} layout="fill" />
          </div>
          {title ? (
            <h3 className={styles.slideTitle}>
              <span>{type}:</span>
              {title}
            </h3>
          ) : null}
        </div>
      ) : (
        <a href={link} target="_blank" className={styles.slideBox}>
          <div className={styles.slideImage}>
            <Image src={imageUrl} alt={title} quality={100} layout="fill" />
          </div>
          {title ? (
            <h3 className={styles.slideTitle}>
              <span>{type}:</span>
              {title}
            </h3>
          ) : null}
        </a>
      )}
    </>
  );
};

export default Slide;
