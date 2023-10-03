import * as React from "react";
import styles from "./index.module.scss";
import Title from "../../../title";

const About = ({}) => (
  <div className={styles.about}>
    <Title content={"About"} />
    <div className={styles.description}>
      <p>
        We are a tech studio building DAOs, DeFi protocols, and tooling for user-empowered futures.
      </p>
      <p>
      Our team is distributed & international, with founding members building in web3 as early as 2017.
      </p>
    </div>
  </div>
);

export default About;
