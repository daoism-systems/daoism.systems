import * as React from "react";
import styles from "./index.module.scss";
import Title from "../../../title";
import Slider from "./slider";

const Team = ({}) => {
  const [activeTab, setActiveTab] = React.useState(0);

  const handleTabClick = (index) => {
    setActiveTab(index.target.getAttribute("data-tab"));
  };
  return (
    <div className={styles.team}>
      <div className={styles.title}>
        <Title content={"Our team"} />

        <ul className={styles.listTab}>
          <li>
            <button type={"button"} onClick={handleTabClick} data-tab={0}>
              Management
            </button>
          </li>
          <li>
            <button type={"button"} onClick={handleTabClick} data-tab={3}>
              Development
            </button>
          </li>
          <li>
            <button type={"button"} onClick={handleTabClick} data-tab={10}>
              Research
            </button>
          </li>
        </ul>
      </div>

      <div className={styles.slider}>
        <Slider activeTab={activeTab} />
      </div>
    </div>
  );
};

export default Team;
