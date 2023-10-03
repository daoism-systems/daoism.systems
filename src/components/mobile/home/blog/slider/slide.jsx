import * as React from "react";
import Link from "next/link";
import Image from "next/image";

import styles from "./slide.module.scss";

const Slide = ({ title, date, imageUrl, link }) => {
  return (
    <Link href={link}>
      <a className={styles.slideBox} target="_blank" >
        <div className={styles.slideImage}>
          <Image src={imageUrl} alt={title} quality={100} layout="fill" />
        </div>
        <div className={styles.slideDate}>{date}</div>
        <h3 className={styles.slideTitle}>{title}</h3>
        <div className={styles.slideLink}>Read post</div>
      </a>
    </Link>
  );
};

export default Slide;
