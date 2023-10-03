import React, { useEffect } from "react";
import styles from "./index.module.scss";
import Title from "../../../title";

const Services = ({}) => {
  const [isActive, setActive] = React.useState("false");
  const [isActive2, setActive2] = React.useState("false");

  const handleToggle = () => {
    setActive(!isActive);
    if (isActive2 === true) {
      setActive2(false);
    }
  };

  const handleToggle2 = () => {
    setActive2(!isActive2);
    if (isActive === true) {
      setActive(false);
    }
  };

  useEffect(() => {
    setActive(false);
    setActive2(false);
  }, []);

  return (
    <div className={styles.services}>
      <Title content={"Technics"} />

      <ul className={styles.servicesList}>
        <li>
          <h3
            onClick={handleToggle}
            className={isActive ? styles.active : null}
          >
            On-Chain Solutions
          </h3>
          <div className={styles.description}>
            Custom design and implementation for on-chain systems across web3
          </div>
          <ul className={isActive ? styles.active : null}>
            <li>DAOs</li>
            <li>DeFi</li>
            <li>dApp Development</li>
          </ul>
        </li>
        <li>
          <h3
            onClick={handleToggle2}
            className={isActive2 ? styles.active : null}
          >
            Consultancy
          </h3>
          <div className={styles.description}>
            Advisory and maintenance for precise system requirements
          </div>
          <ul className={isActive2 ? styles.active : null}>
            <li>Smart Contract Engineering</li>
            <li>Smart Contract Audits</li>
            <li>Tooling Consultation and Development</li>
            <li>Software maintenance</li>
          </ul>
        </li>
      </ul>
    </div>
  );
};

export default Services;
