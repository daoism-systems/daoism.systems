import * as React from "react";
import styles from "./index.module.scss";
import Title from "../../../title";

const Services = ({}) => (
  <div className={styles.services}>
    <Title content={"Services"} />

    <ul className={styles.servicesList}>
      <li>
        <h3>On-Chain Solutions</h3>
        <div className={styles.description}>
          custom design and implementation for on-chain systems across web3
        </div>
      </li>
      <li>
        <h3>Consultancy</h3>
        <div className={styles.description}>
          advisory and maintenance for precise system requirements
        </div>
      </li>
    </ul>
  </div>
);

export default Services;
