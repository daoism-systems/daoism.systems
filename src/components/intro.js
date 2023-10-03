/*
Auto-generated by: https://github.com/pmndrs/gltfjsx
*/

import React, { useEffect, useRef } from 'react'
import * as THREE from 'three';
import {
    useGLTF,
    PerspectiveCamera,
    useAnimations,
    PointMaterial,
    // useTexture
} from '@react-three/drei';
import { TextureLoader } from 'three/src/loaders/TextureLoader'
import { useFrame, useLoader } from '@react-three/fiber';
import { LayerMaterial, Depth, Fresnel, Noise, Displace, Gradient } from 'lamina'
import { MeshStandardMaterial } from 'three';

export default function Model({ ...props }) {
    const group = useRef();
    const { nodes, materials, animations } = useGLTF('/DAO_Enter.gltf');
    const { actions } = useAnimations(animations, group);

    const colorMap = useLoader(TextureLoader, 'texturedot.png');


    console.log(actions, 'actions');
    useEffect(() => {
        actions['1 scale'].clampWhenFinished = true;
        actions['1 scale'].repetitions = 1;
        actions['1 scale'].play();

        actions['2 scale'].clampWhenFinished = true;
        actions['2 scale'].repetitions = 1;
        actions['2 scale'].play();

        actions['sphere controller scale'].clampWhenFinished = true;
        actions['sphere controller scale'].repetitions = 1;
        actions['sphere controller scale'].play();

        actions['circle 1 rotation'].play();
        actions['circle 2 rotation'].play();
        actions['rotation 1'].play();
        actions['rotation 2'].play();
        actions['sphere controller rotation'].play();

        actions['CAMERA OUT'].clampWhenFinished = true;
        actions['CAMERA OUT'].repetitions = 1;
        setTimeout(() => {
            // actions['CAMERA OUT'].play();
        }, 10000);

        console.log(actions['CAMERA OUT']);

    }, [actions]);

    const gradient = 0.6;


    // console.log(actions);
    return (
        <group ref={group} {...props} dispose={null}>
            <group name="Scene">
                <group name="sphere_controller" position={[0, 17.68, 0]} rotation={[-Math.PI, 0, -Math.PI]} scale={1}>
                    <mesh name="circle_1" geometry={nodes.circle_1.geometry} rotation={[-Math.PI, 0, -Math.PI]} scale={1}>
                        <meshStandardMaterial color={'white'} emissive={'white'} />
                    </mesh>
                    <mesh name="circle_2" geometry={nodes.circle_2.geometry} rotation={[-Math.PI, 0, -Math.PI]} scale={1}>
                        <meshStandardMaterial color={'white'} emissive={'white'} />
                    </mesh>
                    <mesh name="sphere" onClick={() => actions['CAMERA OUT'].play()} geometry={nodes.sphere.geometry} rotation={[-Math.PI, 0, -Math.PI]} scale={1}>
                        <LayerMaterial toneMapped={false}>
                            <Fresnel
                                mode="normal"
                                color="#444444"
                                intensity={2}
                                power={5.5}
                                bias={0.001}
                            />
                        </LayerMaterial>
                    </mesh>
                </group>
                <PerspectiveCamera name="Camera" makeDefault={true} far={1000} near={0.1} fov={37.3} position={[0, 5, 55]} />
                <mesh name="orbit_1" geometry={nodes.orbit_1.geometry} material={materials.solid} rotation={[-Math.PI, 0, -Math.PI]} scale={0}>
                    <LayerMaterial toneMapped={false}>
                        {/* <Depth
                            colorA="#ff0080"
                            colorB="black"
                            alpha={1}
                            mode="normal"
                            near={0.5 * gradient}
                            far={0.5}
                            origin={[0, 0, 0]}
                        /> */}
                        <Fresnel
                            mode="normal"
                            color="#cccccc"
                            intensity={0.2}
                            power={5.5}
                            bias={0.001}
                        />

                    </LayerMaterial>
                </mesh>
                <mesh name="orbit_2" geometry={nodes.orbit_2.geometry} position={[0, 10, 0]} rotation={[-Math.PI, 0, -Math.PI]} scale={0}>
                    <LayerMaterial toneMapped={false}>
                        {/* <Depth
                            colorA="red"
                            colorB="yellow"
                            alpha={1}
                            mode="normal"
                            near={0.6}
                            far={0.5}
                            origin={[0, 0, 0]}
                        /> */}
                        <Fresnel
                            mode="normal"
                            color="#cccccc"
                            intensity={0.2}
                            power={5.5}
                            bias={0.001}
                        />

                    </LayerMaterial>
                </mesh>
                <points name="Cylinder" geometry={nodes.Cylinder.geometry} position={[0, -40.79, 0]} scale={[1.09, 1.21, 1.09]}>
                    <PointMaterial transparent color={'#fff'} size={0.6} sizeAttenuation={true} depthWrite={false} map={colorMap} />
                </points>
            </group>
        </group>
    )
}

useGLTF.preload('/DAO_Enter.gltf')
