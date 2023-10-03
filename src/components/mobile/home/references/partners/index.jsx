import * as React from "react";
import styles from "../index.module.scss";

const iconTwo = (
  <svg
    width="63"
    height="37"
    viewBox="0 0 63 37"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M39.4918 36.5V0H49.0656V27.5246H57.4426C60.7934 27.5246 62.0301 29.5191 62.2295 30.5164V36.5H39.4918Z"
      fill="white"
    />
    <path
      d="M26.9262 0L14.959 17.9508L26.9262 36.5H37.6967L25.7295 17.9508L37.6967 0H26.9262Z"
      fill="white"
    />
    <path
      d="M9.57377 31.7131C9.57377 34.3568 7.43061 36.5 4.78689 36.5C2.14316 36.5 0 34.3568 0 31.7131C0 29.0694 2.14316 26.9262 4.78689 26.9262C7.43061 26.9262 9.57377 29.0694 9.57377 31.7131Z"
      fill="white"
    />
    <path
      d="M4.78689 17.9508V2.9918C4.78689 0.598361 6.38251 0 7.18033 0H13.7623V31.1148L4.78689 17.9508Z"
      fill="white"
    />
  </svg>
);

const Partners = ({}) => (
  <div className={`${styles.referencesList} referencesTop`}>
    <a
      href="https://www.thedaoist.co/"
      target="_blank"
      className={styles.topItem}
    >
      <div className={styles.icon}>
          <img src="/daoist.gif" alt="The Daoist" />
      </div>
      <div className={styles.text}>The DAOist</div>
    </a>

    <a
      href="https://ceramic.network/"
      target="_blank"
      className={styles.topItem}
    >
      <div className={styles.icon}>
        <img src="/ceramic_logo_bw.png" alt="Ceramic Network" />
      </div>
      <div className={styles.text}>Ceramic Network</div>
    </a>
  </div>
);

export default Partners;
