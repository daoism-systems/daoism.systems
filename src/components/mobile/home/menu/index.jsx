import React, { useEffect, useState, useRef } from "react";
import styles from "./index.module.scss";
import Social from "../../../social";

const Menu = ({ fixed, scroll }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showMenuList, setShowMenuList] = useState(false);

  const videoRef = useRef();

  const toggle = () => {
    if (showMenu) {
      setTimeout(() => {
        videoRef.current.play();
      }, 300);
      setShowMenuList(false);
      setTimeout(() => {
        setShowMenu(false);
      }, 1000);
    } else {
      setShowMenu(true);
      videoRef.current.playbackRate = 1;
      videoRef.current.currentTime = 0;
      videoRef.current.play();

      setTimeout(() => {
        videoRef.current.pause();
      }, 2000);

      setTimeout(() => {
        setShowMenuList(true);
      }, 1000);
    }
  };

  return (
    <>
      <div className={`${styles.menu} ${showMenu ? styles.active : ""}`}>
        <div className={styles.menubg}>
          <video preload ref={videoRef} playsInline muted>
            <source src={"/menubgmobile.mp4"} />
            <p className={"warning"}>
              Your browser does not support HTML5 video.
            </p>
          </video>
        </div>

        <div
          className={`${styles.menuList} ${showMenuList ? styles.active : ""}`}
        >
          <ul>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0 * scroll.scrollHeight), toggle()
                )}
              >
                Home
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.17 * scroll.scrollHeight), toggle()
                )}
              >
                About
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.305 * scroll.scrollHeight), toggle()
                )}
              >
                Technics
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.426 * scroll.scrollHeight), toggle()
                )}
              >
                Collaborate
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.54 * scroll.scrollHeight), toggle()
                )}
              >
                Ventures
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.61 * scroll.scrollHeight), toggle()
                )}
              >
                Partners
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.69 * scroll.scrollHeight), toggle()
                )}
              >
                Team
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.77 * scroll.scrollHeight), toggle()
                )}
              >
                Build with us
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.85 * scroll.scrollHeight), toggle()
                )}
              >
                Blog
              </button>
            </li>
            <li>
              <button
                type={"button"}
                onClick={() => (
                  (scroll.scrollTop = 0.93 * scroll.scrollHeight), toggle()
                )}
              >
                Contact
              </button>
            </li>
          </ul>
        </div>
        <Social className={styles.menuSocial} />
      </div>

      <button
        onClick={toggle}
        type={"button"}
        className={`${styles.menuButton} ${showMenu ? styles.active : ""} ${
          fixed ? styles.fixed : null
        }`}
      >
        <div className={styles.line}></div>
        <div className={styles.lineDouble}>
          <div className={styles.doub}></div>
          <div className={styles.doub}></div>
        </div>
        <div className={styles.line}></div>
      </button>
    </>
  );
};

export default Menu;
