import React, { useRef, Suspense } from "react";
import * as THREE from "three";
import styles from "./index.module.scss";
import { useFrame } from "@react-three/fiber";
import { ScrollControls, Scroll, useScroll } from "@react-three/drei";
import Model from "../modelMobile";
import Effects from "../eff";
import Logo from "../logo";
import Hero from "../mobile/home/hero";
import About from "../mobile/home/about";
import Services from "../mobile/home/services";
import Work from "../mobile/home/work";
import Contact from "../mobile/home/contact";
import Blog from "../mobile/home/blog";
import Projects from "../mobile/home/projects";
import Build from "../mobile/home/build";
import Menu from "../mobile/home/menu";
import References from "../mobile/home/references";
import Team from "../mobile/home/team";

/* Mobile  */
export default function Mobile() {
  return (
    <Suspense fallback={null}>
      <ScrollContentDesktop />
    </Suspense>
  );
}

// Connect model with scroll
function ModelScroll() {
  const scroll = useScroll();
  const controls = useRef(0);

  useFrame((state, delta) => {
    const offset = scroll.offset;
    controls.current = offset;
  });

  return <Model scroll={controls} />;
}

// Section content with breakpoints
function ContentDesktop() {
  const scroll = useScroll();
  const controls = useRef(0);
  const sectionsRef = useRef();
  const pipe = useRef();

  useFrame(() => {
    const r1 = scroll.visible(0, 0.1);
    const r2 = scroll.visible(0.17, 0.052);
    const r3 = scroll.visible(0.305, 0.055);
    const r4 = scroll.visible(0.426, 0.052);
    const r5 = scroll.visible(0.54, 0.07);
    const r6 = scroll.visible(0.61, 0.07);
    const r7 = scroll.visible(0.69, 0.07);
    const r8 = scroll.visible(0.77, 0.07);
    const r9 = scroll.visible(0.85, 0.07);
    const r10 = scroll.visible(0.93, 0.07);
    const scrollPercent = (scroll.el.scrollTop / scroll.el.scrollHeight) * 1;
    const offset = scroll.offset;
    controls.current = offset;

    if (sectionsRef.current) {
      pipe.current.children[0].classList.toggle(styles.active, r1);
      pipe.current.children[1].classList.toggle(styles.active, r2);
      pipe.current.children[2].classList.toggle(styles.active, r3);
      pipe.current.children[3].classList.toggle(styles.active, r4);
      pipe.current.children[4].classList.toggle(styles.active, r5);
      pipe.current.children[5].classList.toggle(styles.active, r6);
      pipe.current.children[6].classList.toggle(styles.active, r7);
      pipe.current.children[7].classList.toggle(styles.active, r8);
      pipe.current.children[8].classList.toggle(styles.active, r9);
      // pipe.current.children[9].classList.toggle(styles.active, r10);

      sectionsRef.current.children[0].classList.toggle("active", r1);
      sectionsRef.current.children[1].classList.toggle("active", r2);
      sectionsRef.current.children[2].classList.toggle("active", r3);
      sectionsRef.current.children[3].classList.toggle("active", r4);
      sectionsRef.current.children[4].classList.toggle("active", r5);
      sectionsRef.current.children[5].classList.toggle("active", r6);
      sectionsRef.current.children[6].classList.toggle("active", r7);
      sectionsRef.current.children[7].classList.toggle("active", r8);
      sectionsRef.current.children[8].classList.toggle("active", r9);
      // sectionsRef.current.children[9].classList.toggle("active", r10);
    }
  });

  return (
    <Scroll ref={sectionsRef} className={styles.main} html>
      <div className={`${styles.section} section`}>
        <Hero scroll={scroll.el} />
      </div>
      <div className={`${styles.section} section`}>
        <About />
      </div>

      <div className={`${styles.section} section`}>
        <Services />
      </div>

      <div className={`${styles.section} section`}>
        <Work scroll={scroll.el} />
      </div>

      <div className={`${styles.section} section`}>
        <Projects scroll={scroll.el} />
      </div>

      <div className={`${styles.section} sectionReferences section references`}>
        <References />
      </div>

      {/* <div className={`${styles.section} section`}>
        <Team />
      </div> */}

      <div className={`${styles.section} section build`}>
        <Build />
      </div>

      <div className={`${styles.section} section`}>
        <Blog />
      </div>

      <div className={`${styles.section} section`}>
        <Contact />
      </div>

      <div className={styles.overlayBox}>
        <div className={styles.header}>
          <Logo position={"relative"} />
          <Menu scroll={scroll.el} />
        </div>

        <div ref={pipe} className={styles.controlSections}>
          <button
            type={"button"}
            onClick={() => (scroll.el.scrollTop = 0 * scroll.el.scrollHeight)}
          >
            1
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.17 * scroll.el.scrollHeight)
            }
          >
            2
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.305 * scroll.el.scrollHeight)
            }
          >
            3
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.426 * scroll.el.scrollHeight)
            }
          >
            4
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.54 * scroll.el.scrollHeight)
            }
          >
            5
          </button>
          <button
            type={"button"}
            onClick={() => (scroll.el.scrollTop = 0.61 * scroll.el.scrollHeight)}
          >
            6
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.69 * scroll.el.scrollHeight)
            }
          >
            7
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.77 * scroll.el.scrollHeight)
            }
          >
            8
          </button>
          <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.85 * scroll.el.scrollHeight)
            }
          >
            9
          </button>
          {/* <button
            type={"button"}
            onClick={() =>
              (scroll.el.scrollTop = 0.93 * scroll.el.scrollHeight)
            }
          >
            10
          </button> */}
        </div>
      </div>
      <Effects />
    </Scroll>
  );
}

// Mount content on desktop
function ScrollContentDesktop() {
  return (
    <ScrollControls damping={15} distance={14} pages={1}>
      <ModelScroll />
      <ContentDesktop />
    </ScrollControls>
  );
}
