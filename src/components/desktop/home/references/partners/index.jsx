import * as React from "react";
import styles from "../index.module.scss";

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
