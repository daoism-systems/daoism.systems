import * as React from "react";
import Link from "next/link";
import styles from "./index.module.scss";
import Button from "../../../button";

const Hero = ({ scroll }) => (
  <div className={styles.hero}>
    <h1>
      Emerging
      <br />
       Systems
      <br />
      of the future
    </h1>
    <div className={styles.description}>
      web3 venture studio for a self-sovereign internet
    </div>
    <Button name={"Connect now"} link={"https://t.me/+EBSNTw1oFipjZTQ1"} />
  </div>
);

export default Hero;
