import React, { useState } from "react";
import styles from "./index.module.scss";
import Title from "../../../title";
import Button from "../../../button";
import Toggle from "../../../toggle";

const Build = () => {
  const [active, setActive] = useState(null);

  const handleToggle = (index) => {
    if (active === index) {
      setActive(null);
    } else {
      setActive(index);
    }
  };

  return (
    <div className={styles.build}>
      <div className={styles.buildLeft}>
        <video
          autoPlay={true}
          loop={true}
          controls={false}
          playsInline
          muted
          className={`${styles.video} buildVideo`}
        >
          <source src={"/SPIRALS.mp4"} type="video/mp4" />
          <p className={"warning"}>
            Your browser does not support HTML5 video.
          </p>
        </video>
      </div>

      <div className={styles.buildRight}>
        <Title content={"Build the next internet with us"} />
        <div className={styles.description}>
          We offer dynamic projects, competitive salaries, and educational
          enrichment for your personal growth in web3. Current open positions:
        </div>

        <Toggle
          id={1}
          active={active}
          handleToggle={handleToggle}
          title={"Front-End Engineer"}
          description={
            "Your techstack will include, but will not be limited to: Javascript/Typescript, HTML/CSS/SASS, React, Node.js, Ethers.js, Basic knowledge of Aurelia is a plus"
          }
        />

        <Toggle
          id={2}
          active={active}
          handleToggle={handleToggle}
          title={"Smart Contracts Engineer"}
          description={
            "Your techstack will include, but will not be limited to: Ethereum, Solidity, JavaScript, TypeScript, Hardhat, ethers.js"
          }
        />

        <Toggle
          id={3}
          active={active}
          handleToggle={handleToggle}
          title={"Business Development and Partnerships Manager"}
          description={
            "Identify and contact potential clients and partners. Evaluate, negotiate, and close deals. Create and execute optimal growth strategies and development plans."
          }
        />

        <Button name={"Get in touch"} link={"mailto:contact@daoism.systems"} />
      </div>
    </div>
  );
};

export default Build;
