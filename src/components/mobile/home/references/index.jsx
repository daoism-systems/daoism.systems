import * as React from "react";
import styles from "./index.module.scss";
import Title from "../../../title";
import Link from "next/link";
import Button from "../../../button";
import Partners from "./partners";
import Customers from "./customers";
import StepWizard from "react-step-wizard";

const References = ({}) => {
  const [haveInstance, setInstance] = React.useState();
  const Nav = () => {
    const dots = [];
    // if (haveInstance) {
    //   for (let i = 1; i <= haveInstance.totalSteps; i += 1) {
    //     const isActive = haveInstance.currentStep === i;
    //     dots.push(
    //       i === 1 ? (
    //         <button
    //           type={"button"}
    //           key={`step-${i}`}
    //           className={`${styles.dot} ${isActive ? styles.active : ""}`}
    //           onClick={() => haveInstance.goToStep(i)}
    //         >
    //           Customers
    //         </button>
    //       ) : null || i === 2 ? (
    //         <button
    //           type={"button"}
    //           key={`step-${i}`}
    //           className={`${styles.dot} ${isActive ? styles.active : ""}`}
    //           onClick={() => haveInstance.goToStep(i)}
    //         >
    //           Partners
    //         </button>
    //       ) : null
    //     );
    //   }
    // }

    return <div className={styles.referencesTabs}>{dots}</div>;
  };

  return (
    <div className={styles.references}>
      <Title content={"Partners"} />

      <div className={styles.referencesAnimation}>
        <div className={styles.circleOne}>
          <svg
            width="2989"
            height="2989"
            viewBox="0 0 2989 2989"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="1494.08"
              cy="1494.08"
              r="1493.58"
              transform="rotate(90 1494.08 1494.08)"
              stroke="url(#paint0)"
            />
            <defs>
              <linearGradient
                id="paint0"
                x1="3669.29"
                y1="1440.98"
                x2="-749.549"
                y2="293.576"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0.0093826" stopColor="#0A0A0A" />
                <stop offset="0.0334768" stopColor="#CCCCCC" />
                <stop offset="0.0552728" stopColor="#0A0A0A" />
                <stop offset="0.106675" stopColor="#0A0A0A" />
                <stop offset="0.125449" stopColor="#CCCCCC" />
                <stop offset="0.142057" stopColor="#0A0A0A" />
                <stop offset="0.239413" stopColor="#0A0A0A" />
                <stop offset="0.267248" stopColor="#CCCCCC" />
                <stop offset="0.288847" stopColor="#0A0A0A" />
                <stop offset="0.397263" stopColor="#0A0A0A" />
                <stop offset="0.41361" stopColor="#CCCCCC" />
                <stop offset="0.444691" stopColor="#CCCCCC" />
                <stop offset="0.474759" stopColor="#0A0A0A" />
                <stop offset="0.564465" stopColor="#0A0A0A" />
                <stop offset="0.582354" stopColor="#CCCCCC" />
                <stop offset="0.599784" stopColor="#0A0A0A" />
                <stop offset="0.64117" stopColor="#0A0A0A" />
                <stop offset="0.666183" stopColor="#CCCCCC" />
                <stop offset="0.698743" stopColor="#0A0A0A" />
                <stop offset="0.733801" stopColor="#0A0A0A" />
                <stop offset="0.75947" stopColor="#CCCCCC" />
                <stop offset="0.785203" stopColor="#0A0A0A" />
                <stop offset="0.830631" stopColor="#0A0A0A" />
                <stop offset="0.857874" stopColor="#CCCCCC" />
                <stop offset="0.8861" stopColor="#0A0A0A" />
                <stop offset="0.936519" stopColor="#0A0A0A" />
                <stop offset="0.969079" stopColor="#CCCCCC" />
                <stop offset="1" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div className={styles.circleTwo}>
          <svg
            width="2989"
            height="2989"
            viewBox="0 0 2989 2989"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="1494.08"
              cy="1494.08"
              r="1493.58"
              transform="rotate(90 1494.08 1494.08)"
              stroke="url(#paint1)"
            />
            <defs>
              <linearGradient
                id="paint1"
                x1="3669.29"
                y1="1440.98"
                x2="-749.549"
                y2="293.576"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0.0093826" stopColor="#0A0A0A" />
                <stop offset="0.0334768" stopColor="#CCCCCC" />
                <stop offset="0.0552728" stopColor="#0A0A0A" />
                <stop offset="0.106675" stopColor="#0A0A0A" />
                <stop offset="0.125449" stopColor="#CCCCCC" />
                <stop offset="0.142057" stopColor="#0A0A0A" />
                <stop offset="0.239413" stopColor="#0A0A0A" />
                <stop offset="0.267248" stopColor="#CCCCCC" />
                <stop offset="0.288847" stopColor="#0A0A0A" />
                <stop offset="0.397263" stopColor="#0A0A0A" />
                <stop offset="0.41361" stopColor="#CCCCCC" />
                <stop offset="0.444691" stopColor="#CCCCCC" />
                <stop offset="0.474759" stopColor="#0A0A0A" />
                <stop offset="0.564465" stopColor="#0A0A0A" />
                <stop offset="0.582354" stopColor="#CCCCCC" />
                <stop offset="0.599784" stopColor="#0A0A0A" />
                <stop offset="0.64117" stopColor="#0A0A0A" />
                <stop offset="0.666183" stopColor="#CCCCCC" />
                <stop offset="0.698743" stopColor="#0A0A0A" />
                <stop offset="0.733801" stopColor="#0A0A0A" />
                <stop offset="0.75947" stopColor="#CCCCCC" />
                <stop offset="0.785203" stopColor="#0A0A0A" />
                <stop offset="0.830631" stopColor="#0A0A0A" />
                <stop offset="0.857874" stopColor="#CCCCCC" />
                <stop offset="0.8861" stopColor="#0A0A0A" />
                <stop offset="0.936519" stopColor="#0A0A0A" />
                <stop offset="0.969079" stopColor="#CCCCCC" />
                <stop offset="1" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <div className={styles.circleThree}>
          <svg
            width="2989"
            height="2989"
            viewBox="0 0 2989 2989"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="1494.08"
              cy="1494.08"
              r="1493.58"
              transform="rotate(90 1494.08 1494.08)"
              stroke="url(#paint2)"
            />
            <defs>
              <linearGradient
                id="paint2"
                x1="3669.29"
                y1="1440.98"
                x2="-749.549"
                y2="293.576"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0.0093826" stopColor="#0A0A0A" />
                <stop offset="0.0334768" stopColor="#CCCCCC" />
                <stop offset="0.0552728" stopColor="#0A0A0A" />
                <stop offset="0.106675" stopColor="#0A0A0A" />
                <stop offset="0.125449" stopColor="#CCCCCC" />
                <stop offset="0.142057" stopColor="#0A0A0A" />
                <stop offset="0.239413" stopColor="#0A0A0A" />
                <stop offset="0.267248" stopColor="#CCCCCC" />
                <stop offset="0.288847" stopColor="#0A0A0A" />
                <stop offset="0.397263" stopColor="#0A0A0A" />
                <stop offset="0.41361" stopColor="#CCCCCC" />
                <stop offset="0.444691" stopColor="#CCCCCC" />
                <stop offset="0.474759" stopColor="#0A0A0A" />
                <stop offset="0.564465" stopColor="#0A0A0A" />
                <stop offset="0.582354" stopColor="#CCCCCC" />
                <stop offset="0.599784" stopColor="#0A0A0A" />
                <stop offset="0.64117" stopColor="#0A0A0A" />
                <stop offset="0.666183" stopColor="#CCCCCC" />
                <stop offset="0.698743" stopColor="#0A0A0A" />
                <stop offset="0.733801" stopColor="#0A0A0A" />
                <stop offset="0.75947" stopColor="#CCCCCC" />
                <stop offset="0.785203" stopColor="#0A0A0A" />
                <stop offset="0.830631" stopColor="#0A0A0A" />
                <stop offset="0.857874" stopColor="#CCCCCC" />
                <stop offset="0.8861" stopColor="#0A0A0A" />
                <stop offset="0.936519" stopColor="#0A0A0A" />
                <stop offset="0.969079" stopColor="#CCCCCC" />
                <stop offset="1" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

        <Customers />
        <Partners />
      {/* <StepWizard instance={setInstance} nav={<Nav />}>
      </StepWizard> */}
    </div>
  );
};

export default References;
