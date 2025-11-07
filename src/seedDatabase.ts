import { prisma } from "./lib/prisma.js";
import { hash } from "bcryptjs";
import { logger } from "./utils/logger.js";

export async function clearDatabase() {
    // Delete in order to respect foreign key constraints
    // Delete notifications first (they reference users)
    logger.info('Clearing database');
    await prisma.notification.deleteMany();
    
    // Delete chat-related records
    await prisma.mention.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.labChat.deleteMany();
    await prisma.conversation.deleteMany();
    
    // Delete other records that reference users
    await prisma.submission.deleteMany();
    await prisma.assignment.deleteMany();
    await prisma.announcement.deleteMany();
    await prisma.event.deleteMany();
    await prisma.attendance.deleteMany();
    
    // Delete class-related records
    await prisma.section.deleteMany();
    await prisma.markScheme.deleteMany();
    await prisma.gradingBoundary.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.class.deleteMany();
    
    // Delete user-related records
    await prisma.session.deleteMany();
    await prisma.userProfile.deleteMany();
    
    // Delete users first
    await prisma.user.deleteMany();
    
    // Delete schools (which reference files for logos) - this will cascade delete the file references
    await prisma.school.deleteMany();
    
    // Finally delete all files
    await prisma.file.deleteMany();
}

export async function createUser(email: string, password: string, username: string) {
    logger.debug("Creating user", { email, username, password });

    const hashedPassword = await hash(password, 10);
    return await prisma.user.create({
        data: { email, password: hashedPassword, username, verified: true },
    });
}

export async function addNotification(userId: string, title: string, content: string) {
    return await prisma.notification.create({
        data: {
            receiverId: userId,
            title,
            content,
        },
    });
}

export const seedDatabase = async () => {
    await clearDatabase();
    logger.info('Cleared database');

    // Create comprehensive demo data for teacher demo video
    
    // 1. Create School
    const demoFile = await prisma.file.create({
        data: {
            name: 'school_logo.png',
            path: 'logos/demo_school.png',
            type: 'image/png',
            size: 15000,
        }
    });

    const school = await prisma.school.create({
        data: {
            name: 'Riverside High School',
            logoId: demoFile.id,
            subdomain: 'riverside',
        }
    });

    // 2. Create Teachers
    const teachers = await Promise.all([
        createUser('sarah.johnson@riverside.edu', 'demo123', 'sarah.johnson'),
        createUser('michael.chen@riverside.edu', 'demo123', 'michael.chen'),
        createUser('emma.davis@riverside.edu', 'demo123', 'emma.davis'),
    ]);

    // 3. Create Students (realistic names)
    const students = await Promise.all([
        createUser('alex.martinez@student.rverside.eidu', 'student123', 'alex.martinez'),
        createUser('sophia.williams@student.riverside.edu', 'student123', 'sophia.williams'),
        createUser('james.brown@student.riverside.edu', 'student123', 'james.brown'),
        createUser('olivia.taylor@student.riverside.edu', 'student123', 'olivia.taylor'),
        createUser('ethan.anderson@student.riverside.edu', 'student123', 'ethan.anderson'),
        createUser('ava.thomas@student.riverside.edu', 'student123', 'ava.thomas'),
        createUser('noah.jackson@student.riverside.edu', 'student123', 'noah.jackson'),
        createUser('isabella.white@student.riverside.edu', 'student123', 'isabella.white'),
        createUser('liam.harris@student.riverside.edu', 'student123', 'liam.harris'),
        createUser('mia.clark@student.riverside.edu', 'student123', 'mia.clark'),
        createUser('lucas.lewis@student.riverside.edu', 'student123', 'lucas.lewis'),
        createUser('charlotte.walker@student.riverside.edu', 'student123', 'charlotte.walker'),
    ]);

    // 4. Create User Profiles
    await Promise.all([
        prisma.userProfile.create({
            data: {
                userId: teachers[0].id,
                displayName: 'Dr. Sarah Johnson',
                bio: 'Biology teacher with 15 years of experience. Passionate about making science accessible to all students.',
                location: 'Riverside, CA',
                website: 'https://sarahjohnson-bio.com',
            }
        }),
        prisma.userProfile.create({
            data: {
                userId: teachers[1].id,
                displayName: 'Mr. Michael Chen',
                bio: 'Mathematics teacher and department head. Specializes in AP Calculus and Statistics.',
                location: 'Riverside, CA',
            }
        }),
        prisma.userProfile.create({
            data: {
                userId: teachers[2].id,
                displayName: 'Ms. Emma Davis',
                bio: 'English Literature teacher. Loves fostering creative writing and critical thinking.',
                location: 'Riverside, CA',
            }
        }),
    ]);

    // Add profiles for some students
    await Promise.all(students.slice(0, 6).map((student, index) => {
        const names = ['Alex Martinez', 'Sophia Williams', 'James Brown', 'Olivia Taylor', 'Ethan Anderson', 'Ava Thomas'];
        return prisma.userProfile.create({
            data: {
                userId: student.id,
                displayName: names[index],
                bio: `Grade 11 student at Riverside High School.`,
            }
        });
    }));

    // 5. Create Classes with realistic subjects
    const biologyClass = await prisma.class.create({
        data: {
            name: 'AP Biology',
            subject: 'Biology',
            section: 'Period 3',
            color: '#10B981',
            syllabus: 'Advanced Placement Biology covering molecular biology, genetics, evolution, ecology, and more.',
            schoolId: school.id,
            teachers: { connect: { id: teachers[0].id } },
            students: { connect: students.slice(0, 8).map(s => ({ id: s.id })) },
        },
    });

    const mathClass = await prisma.class.create({
        data: {
            name: 'AP Calculus BC',
            subject: 'Mathematics',
            section: 'Period 2',
            color: '#3B82F6',
            syllabus: 'Advanced calculus including limits, derivatives, integrals, and series.',
            schoolId: school.id,
            teachers: { connect: { id: teachers[1].id } },
            students: { connect: students.slice(4, 12).map(s => ({ id: s.id })) },
        },
    });

    const englishClass = await prisma.class.create({
        data: {
            name: 'English Literature',
            subject: 'English',
            section: 'Period 1',
            color: '#8B5CF6',
            syllabus: 'Study of classic and contemporary literature with focus on analysis and writing.',
            schoolId: school.id,
            teachers: { connect: { id: teachers[2].id } },
            students: { connect: students.slice(0, 10).map(s => ({ id: s.id })) },
        },
    });

    // 6. Create Sections for organization
    const bioSections = await Promise.all([
        prisma.section.create({
            data: { name: 'Unit 1: Chemistry of Life', classId: biologyClass.id, color: '#EF4444', order: 1 }
        }),
        prisma.section.create({
            data: { name: 'Unit 2: Cell Structure', classId: biologyClass.id, color: '#F97316', order: 2 }
        }),
        prisma.section.create({
            data: { name: 'Unit 3: Cellular Processes', classId: biologyClass.id, color: '#EAB308', order: 3 }
        }),
        prisma.section.create({
            data: { name: 'Unit 4: Genetics', classId: biologyClass.id, color: '#22C55E', order: 4 }
        }),
    ]);

    const mathSections = await Promise.all([
        prisma.section.create({
            data: { name: 'Limits and Continuity', classId: mathClass.id, color: '#3B82F6', order: 1 }
        }),
        prisma.section.create({
            data: { name: 'Derivatives', classId: mathClass.id, color: '#6366F1', order: 2 }
        }),
        prisma.section.create({
            data: { name: 'Integrals', classId: mathClass.id, color: '#8B5CF6', order: 3 }
        }),
    ]);

    // 7. Create mark schemes first
    const bioMarkScheme = await prisma.markScheme.create({
        data: {
            classId: biologyClass.id,
            structured: JSON.stringify({
                name: 'Biology Assessment Rubric',
                criteria: [
                    {
                        id: 'scientific-accuracy',
                        title: 'Scientific Accuracy',
                        description: 'Correct use of scientific terminology and concepts',
                        levels: [
                            {
                                id: 'excellent',
                                name: 'Excellent',
                                description: 'All scientific terms and concepts used correctly with precision',
                                points: 4,
                                color: '#10B981'
                            },
                            {
                                id: 'proficient',
                                name: 'Proficient',
                                description: 'Most scientific terms and concepts used correctly',
                                points: 3,
                                color: '#3B82F6'
                            },
                            {
                                id: 'developing',
                                name: 'Developing',
                                description: 'Some scientific terms used correctly, minor errors present',
                                points: 2,
                                color: '#F59E0B'
                            },
                            {
                                id: 'beginning',
                                name: 'Beginning',
                                description: 'Limited use of scientific terminology, significant errors',
                                points: 1,
                                color: '#EF4444'
                            }
                        ]
                    },
                    {
                        id: 'analysis-reasoning',
                        title: 'Analysis & Reasoning',
                        description: 'Quality of analysis and logical reasoning',
                        levels: [
                            {
                                id: 'excellent',
                                name: 'Excellent',
                                description: 'Clear, sophisticated analysis with logical connections',
                                points: 4,
                                color: '#10B981'
                            },
                            {
                                id: 'proficient',
                                name: 'Proficient',
                                description: 'Good analysis with mostly logical reasoning',
                                points: 3,
                                color: '#3B82F6'
                            },
                            {
                                id: 'developing',
                                name: 'Developing',
                                description: 'Basic analysis with some logical gaps',
                                points: 2,
                                color: '#F59E0B'
                            },
                            {
                                id: 'beginning',
                                name: 'Beginning',
                                description: 'Limited analysis, unclear reasoning',
                                points: 1,
                                color: '#EF4444'
                            }
                        ]
                    },
                    {
                        id: 'communication',
                        title: 'Communication',
                        description: 'Clear writing and proper formatting',
                        levels: [
                            {
                                id: 'excellent',
                                name: 'Excellent',
                                description: 'Clear, well-organized writing with proper format',
                                points: 4,
                                color: '#10B981'
                            },
                            {
                                id: 'proficient',
                                name: 'Proficient',
                                description: 'Generally clear writing with good organization',
                                points: 3,
                                color: '#3B82F6'
                            },
                            {
                                id: 'developing',
                                name: 'Developing',
                                description: 'Adequate writing with some organizational issues',
                                points: 2,
                                color: '#F59E0B'
                            },
                            {
                                id: 'beginning',
                                name: 'Beginning',
                                description: 'Unclear writing, poor organization',
                                points: 1,
                                color: '#EF4444'
                            }
                        ]
                    },
                    {
                        id: 'evidence-examples',
                        title: 'Evidence & Examples',
                        description: 'Use of relevant examples and evidence',
                        levels: [
                            {
                                id: 'excellent',
                                name: 'Excellent',
                                description: 'Strong, relevant examples that enhance understanding',
                                points: 4,
                                color: '#10B981'
                            },
                            {
                                id: 'proficient',
                                name: 'Proficient',
                                description: 'Good examples that support main points',
                                points: 3,
                                color: '#3B82F6'
                            },
                            {
                                id: 'developing',
                                name: 'Developing',
                                description: 'Some examples provided, may lack relevance',
                                points: 2,
                                color: '#F59E0B'
                            },
                            {
                                id: 'beginning',
                                name: 'Beginning',
                                description: 'Few or no relevant examples provided',
                                points: 1,
                                color: '#EF4444'
                            }
                        ]
                    }
                ]
            })
        }
    });

    const mathMarkScheme = await prisma.markScheme.create({
        data: {
            classId: mathClass.id,
            structured: JSON.stringify({
                name: 'Mathematics Assessment Rubric',
                criteria: [
                    {
                        id: 'mathematical-accuracy',
                        title: 'Mathematical Accuracy',
                        description: 'Correct calculations and mathematical procedures',
                        levels: [
                            {
                                id: 'excellent',
                                name: 'Excellent',
                                description: 'All calculations correct, proper mathematical procedures',
                                points: 4,
                                color: '#10B981'
                            },
                            {
                                id: 'proficient',
                                name: 'Proficient',
                                description: 'Most calculations correct, minor computational errors',
                                points: 3,
                                color: '#3B82F6'
                            },
                            {
                                id: 'developing',
                                name: 'Developing',
                                description: 'Some calculations correct, several errors present',
                                points: 2,
                                color: '#F59E0B'
                            },
                            {
                                id: 'beginning',
                                name: 'Beginning',
                                description: 'Many calculation errors, incorrect procedures',
                                points: 1,
                                color: '#EF4444'
                            }
                        ]
                    },
                    {
                        id: 'problem-solving',
                        title: 'Problem-Solving Strategy',
                        description: 'Appropriate method selection and setup',
                        levels: [
                            {
                                id: 'excellent',
                                name: 'Excellent',
                                description: 'Optimal strategy chosen, excellent problem setup',
                                points: 4,
                                color: '#10B981'
                            },
                            {
                                id: 'proficient',
                                name: 'Proficient',
                                description: 'Good strategy, appropriate problem approach',
                                points: 3,
                                color: '#3B82F6'
                            },
                            {
                                id: 'developing',
                                name: 'Developing',
                                description: 'Adequate strategy, some setup issues',
                                points: 2,
                                color: '#F59E0B'
                            },
                            {
                                id: 'beginning',
                                name: 'Beginning',
                                description: 'Poor strategy choice, unclear setup',
                                points: 1,
                                color: '#EF4444'
                            }
                        ]
                    },
                    {
                        id: 'work-shown',
                        title: 'Work Shown',
                        description: 'Clear step-by-step work and explanations',
                        levels: [
                            {
                                id: 'excellent',
                                name: 'Excellent',
                                description: 'All work clearly shown with detailed explanations',
                                points: 4,
                                color: '#10B981'
                            },
                            {
                                id: 'proficient',
                                name: 'Proficient',
                                description: 'Most work shown, good explanations',
                                points: 3,
                                color: '#3B82F6'
                            },
                            {
                                id: 'developing',
                                name: 'Developing',
                                description: 'Some work shown, limited explanations',
                                points: 2,
                                color: '#F59E0B'
                            },
                            {
                                id: 'beginning',
                                name: 'Beginning',
                                description: 'Little work shown, unclear process',
                                points: 1,
                                color: '#EF4444'
                            }
                        ]
                    },
                    {
                        id: 'final-answer',
                        title: 'Final Answer',
                        description: 'Correct final answer with proper units/notation',
                        levels: [
                            {
                                id: 'excellent',
                                name: 'Excellent',
                                description: 'Correct answer with proper units and notation',
                                points: 4,
                                color: '#10B981'
                            },
                            {
                                id: 'proficient',
                                name: 'Proficient',
                                description: 'Correct answer, minor notation issues',
                                points: 3,
                                color: '#3B82F6'
                            },
                            {
                                id: 'developing',
                                name: 'Developing',
                                description: 'Answer close to correct, some notation errors',
                                points: 2,
                                color: '#F59E0B'
                            },
                            {
                                id: 'beginning',
                                name: 'Beginning',
                                description: 'Incorrect answer or missing units',
                                points: 1,
                                color: '#EF4444'
                            }
                        ]
                    }
                ]
            })
        }
    });

    // 8. Create grading boundaries
    const mathGradingBoundary = await prisma.gradingBoundary.create({
        data: {
            classId: mathClass.id,
            structured: JSON.stringify({
                name: 'AP Calculus BC Grading Scale',
                boundaries: [
                    {
                        id: 'a-plus',
                        grade: 'A+',
                        minPercentage: 97,
                        maxPercentage: 100,
                        description: 'Exceptional mastery of all concepts',
                        color: '#059669'
                    },
                    {
                        id: 'a',
                        grade: 'A',
                        minPercentage: 93,
                        maxPercentage: 96,
                        description: 'Strong mastery of concepts',
                        color: '#10B981'
                    },
                    {
                        id: 'a-minus',
                        grade: 'A-',
                        minPercentage: 90,
                        maxPercentage: 92,
                        description: 'Good mastery with minor gaps',
                        color: '#34D399'
                    },
                    {
                        id: 'b-plus',
                        grade: 'B+',
                        minPercentage: 87,
                        maxPercentage: 89,
                        description: 'Above average understanding',
                        color: '#1D4ED8'
                    },
                    {
                        id: 'b',
                        grade: 'B',
                        minPercentage: 83,
                        maxPercentage: 86,
                        description: 'Solid understanding of most concepts',
                        color: '#3B82F6'
                    },
                    {
                        id: 'b-minus',
                        grade: 'B-',
                        minPercentage: 80,
                        maxPercentage: 82,
                        description: 'Adequate understanding with some gaps',
                        color: '#60A5FA'
                    },
                    {
                        id: 'c-plus',
                        grade: 'C+',
                        minPercentage: 77,
                        maxPercentage: 79,
                        description: 'Basic understanding, needs improvement',
                        color: '#D97706'
                    },
                    {
                        id: 'c',
                        grade: 'C',
                        minPercentage: 73,
                        maxPercentage: 76,
                        description: 'Minimal acceptable understanding',
                        color: '#F59E0B'
                    },
                    {
                        id: 'c-minus',
                        grade: 'C-',
                        minPercentage: 70,
                        maxPercentage: 72,
                        description: 'Below average, significant gaps',
                        color: '#FBBF24'
                    },
                    {
                        id: 'd',
                        grade: 'D',
                        minPercentage: 60,
                        maxPercentage: 69,
                        description: 'Poor understanding, major deficiencies',
                        color: '#F87171'
                    },
                    {
                        id: 'f',
                        grade: 'F',
                        minPercentage: 0,
                        maxPercentage: 59,
                        description: 'Inadequate understanding, does not meet standards',
                        color: '#EF4444'
                    }
                ]
            })
        }
    });

    // 9. Create realistic assignments (more for Calc BC)
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const assignments = await Promise.all([
        // Biology assignments
        prisma.assignment.create({
            data: {
                title: 'Cell Structure Lab Report',
                instructions: 'Complete the microscopy lab and write a detailed report on your observations of plant and animal cells. Include labeled diagrams and compare/contrast the structures you observed.',
                dueDate: nextWeek,
                teacherId: teachers[0].id,
                classId: biologyClass.id,
                sectionId: bioSections[1].id,
                type: 'LAB',
                maxGrade: 100,
                weight: 1.5,
                markSchemeId: bioMarkScheme.id,
            }
        }),
        prisma.assignment.create({
            data: {
                title: 'Genetics Problem Set',
                instructions: 'Solve the genetics problems on pages 234-237. Show all work including Punnett squares and probability calculations.',
                dueDate: tomorrow,
                teacherId: teachers[0].id,
                classId: biologyClass.id,
                sectionId: bioSections[3].id,
                type: 'HOMEWORK',
                maxGrade: 50,
                weight: 1.0,
                markSchemeId: bioMarkScheme.id,
            }
        }),
        prisma.assignment.create({
            data: {
                title: 'Evolution Essay',
                instructions: 'Write a 5-page essay on the evidence for evolution. Use at least 5 scientific sources and cite them properly.',
                dueDate: nextMonth,
                teacherId: teachers[0].id,
                classId: biologyClass.id,
                type: 'ESSAY',
                maxGrade: 100,
                weight: 2.0,
                markSchemeId: bioMarkScheme.id,
            }
        }),
        
        // Math assignments (expanded for demo)
        prisma.assignment.create({
            data: {
                title: 'Limits and Continuity Test',
                instructions: 'Comprehensive test covering limits, continuity, and the Intermediate Value Theorem. Calculators allowed for Section B only.',
                dueDate: lastWeek, // Already completed
                teacherId: teachers[1].id,
                classId: mathClass.id,
                sectionId: mathSections[0].id,
                type: 'TEST',
                maxGrade: 100,
                weight: 2.5,
                markSchemeId: mathMarkScheme.id,
                gradingBoundaryId: mathGradingBoundary.id,
                graded: true,
            }
        }),
        prisma.assignment.create({
            data: {
                title: 'Limits Practice Problems',
                instructions: 'Complete problems 1-25 on page 89. Focus on algebraic manipulation and graphical analysis.',
                dueDate: yesterday, // Just submitted
                teacherId: teachers[1].id,
                classId: mathClass.id,
                sectionId: mathSections[0].id,
                type: 'HOMEWORK',
                maxGrade: 25,
                weight: 1.0,
                markSchemeId: mathMarkScheme.id,
                gradingBoundaryId: mathGradingBoundary.id,
            }
        }),
        prisma.assignment.create({
            data: {
                title: 'Derivative Applications Quiz',
                instructions: 'Quiz covering related rates, optimization, and curve sketching.',
                dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
                teacherId: teachers[1].id,
                classId: mathClass.id,
                sectionId: mathSections[1].id,
                type: 'QUIZ',
                maxGrade: 75,
                weight: 1.5,
                markSchemeId: mathMarkScheme.id,
                gradingBoundaryId: mathGradingBoundary.id,
            }
        }),
        prisma.assignment.create({
            data: {
                title: 'Integration Techniques Homework',
                instructions: 'Complete problems 1-30 on pages 156-158. Practice integration by parts, substitution, and partial fractions.',
                dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
                teacherId: teachers[1].id,
                classId: mathClass.id,
                sectionId: mathSections[2].id,
                type: 'HOMEWORK',
                maxGrade: 30,
                weight: 1.0,
                markSchemeId: mathMarkScheme.id,
                gradingBoundaryId: mathGradingBoundary.id,
            }
        }),
        prisma.assignment.create({
            data: {
                title: 'AP Practice Test - Derivatives',
                instructions: 'Complete this practice AP exam focusing on derivatives and their applications. Time limit: 90 minutes.',
                dueDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
                teacherId: teachers[1].id,
                classId: mathClass.id,
                sectionId: mathSections[1].id,
                type: 'TEST',
                maxGrade: 108, // AP style scoring
                weight: 2.5,
                markSchemeId: mathMarkScheme.id,
                gradingBoundaryId: mathGradingBoundary.id,
            }
        }),
        prisma.assignment.create({
            data: {
                title: 'Calculus Project: Real-World Applications',
                instructions: 'Choose a real-world scenario and create a presentation showing how calculus is used. Include derivatives, integrals, and optimization. 10-minute presentation required.',
                dueDate: new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000),
                teacherId: teachers[1].id,
                classId: mathClass.id,
                type: 'PROJECT',
                maxGrade: 150,
                weight: 3.0,
                markSchemeId: mathMarkScheme.id,
                gradingBoundaryId: mathGradingBoundary.id,
            }
        }),
    ]);

    // 10. Create comprehensive submissions for all students and assignments
    const submissionsToCreate: any[] = [];
    
    // Helper function to generate realistic grades based on assignment type and student performance
    const generateGrade = (maxGrade: number, studentIndex: number, assignmentType: string) => {
        // Create some variation in student performance
        const basePerformance = [0.92, 0.88, 0.85, 0.90, 0.82, 0.87, 0.91, 0.84, 0.89, 0.86, 0.83, 0.88]; // Different performance levels
        const performance = basePerformance[studentIndex % basePerformance.length];
        
        // Adjust based on assignment type
        let multiplier = performance;
        if (assignmentType === 'TEST') multiplier -= 0.05; // Tests are harder
        if (assignmentType === 'QUIZ') multiplier -= 0.02; // Quizzes slightly harder
        if (assignmentType === 'HOMEWORK') multiplier += 0.03; // Homework gets better grades
        
        // Add some randomness
        const randomFactor = (Math.random() - 0.5) * 0.1; // ±5%
        const finalGrade = Math.round(maxGrade * (multiplier + randomFactor));
        
        return Math.max(0, Math.min(maxGrade, finalGrade)); // Clamp between 0 and maxGrade
    };

    // Generate teacher comments based on grade
    const generateComment = (grade: number, maxGrade: number, assignmentType: string) => {
        const percentage = (grade / maxGrade) * 100;
        const comments = {
            excellent: [
                'Excellent work! Your understanding of the concepts is clear.',
                'Outstanding performance. Keep up the great work!',
                'Impressive analysis and problem-solving approach.',
                'Perfect execution. Your work demonstrates mastery of the material.'
            ],
            good: [
                'Good work overall. Minor areas for improvement noted.',
                'Solid understanding demonstrated. Watch calculation accuracy.',
                'Well done! A few small errors but good conceptual grasp.',
                'Nice job. Consider reviewing the highlighted sections.'
            ],
            average: [
                'Adequate work. Please review the concepts we discussed in class.',
                'Shows basic understanding but needs more practice.',
                'Fair attempt. Come see me during office hours for extra help.',
                'Meets expectations. Focus on showing more detailed work.'
            ],
            needs_improvement: [
                'Needs significant improvement. Please schedule a meeting to discuss.',
                'Below expectations. Additional practice and review required.',
                'Struggling with key concepts. Let\'s work together to improve.',
                'Requires more effort and attention to detail.'
            ]
        };

        let category: keyof typeof comments;
        if (percentage >= 90) category = 'excellent';
        else if (percentage >= 80) category = 'good';
        else if (percentage >= 70) category = 'average';
        else category = 'needs_improvement';

        return comments[category][Math.floor(Math.random() * comments[category].length)];
    };

    // Create submissions for Biology assignments (students 0-7)
    for (let i = 0; i < 3; i++) { // First 3 assignments are Biology
        const assignment = assignments[i];
        const maxGrade = assignment.maxGrade || 100; // Default to 100 if null
        for (let j = 0; j < 8; j++) { // 8 students in Biology
            const student = students[j];
            const grade = generateGrade(maxGrade, j, assignment.type);
            const isSubmitted = Math.random() > 0.1; // 90% submission rate
            const isGraded = i < 2; // First 2 assignments are graded
            
            submissionsToCreate.push({
                assignmentId: assignment.id,
                studentId: student.id,
                submitted: isSubmitted,
                submittedAt: isSubmitted ? new Date(assignment.dueDate.getTime() - Math.random() * 24 * 60 * 60 * 1000) : null,
                gradeReceived: isGraded && isSubmitted ? grade : null,
                teacherComments: isGraded && isSubmitted ? generateComment(grade, maxGrade, assignment.type) : null,
                returned: isGraded && isSubmitted,
            });
        }
    }

    // Create submissions for Math assignments (students 4-11) - 8 students
    for (let i = 3; i < assignments.length; i++) { // Math assignments start at index 3
        const assignment = assignments[i];
        const maxGrade = assignment.maxGrade || 100; // Default to 100 if null
        for (let j = 4; j < 12; j++) { // Students 4-11 are in Math class
            const student = students[j];
            const grade = generateGrade(maxGrade, j, assignment.type);
            
            // Determine submission and grading status based on due date
            const isOverdue = assignment.dueDate < now;
            const isDueSoon = assignment.dueDate < tomorrow;
            const isSubmitted = isOverdue || (isDueSoon && Math.random() > 0.2) || Math.random() > 0.15; // Higher submission rate for math
            const isGraded = isOverdue && assignment.graded; // Only grade overdue assignments
            
            submissionsToCreate.push({
                assignmentId: assignment.id,
                studentId: student.id,
                submitted: isSubmitted,
                submittedAt: isSubmitted ? new Date(assignment.dueDate.getTime() - Math.random() * 48 * 60 * 60 * 1000) : null,
                gradeReceived: isGraded && isSubmitted ? grade : null,
                teacherComments: isGraded && isSubmitted ? generateComment(grade, maxGrade, assignment.type) : null,
                returned: isGraded && isSubmitted,
                rubricState: isGraded && isSubmitted ? JSON.stringify({
                    criteria: [
                        { name: 'Mathematical Accuracy', score: Math.round(grade * 0.5), maxScore: Math.round(maxGrade * 0.5) },
                        { name: 'Problem-Solving Strategy', score: Math.round(grade * 0.25), maxScore: Math.round(maxGrade * 0.25) },
                        { name: 'Work Shown', score: Math.round(grade * 0.15), maxScore: Math.round(maxGrade * 0.15) },
                        { name: 'Final Answer', score: Math.round(grade * 0.1), maxScore: Math.round(maxGrade * 0.1) }
                    ]
                }) : null,
            });
        }
    }

    // Create all submissions
    await Promise.all(submissionsToCreate.map(submission => 
        prisma.submission.create({ data: submission })
    ));

    // 11. Create announcements
    await Promise.all([
        prisma.announcement.create({
            data: {
                remarks: 'Reminder: Lab safety quiz next Tuesday. Please review the safety protocols we discussed in class.',
                teacherId: teachers[0].id,
                classId: biologyClass.id,
                createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
            }
        }),
        prisma.announcement.create({
            data: {
                remarks: 'Great job on the recent quiz, everyone! The class average was 87%. Keep up the excellent work!',
                teacherId: teachers[1].id,
                classId: mathClass.id,
                createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
            }
        }),
        prisma.announcement.create({
            data: {
                remarks: 'Don\'t forget: Parent-teacher conferences are next week. Sign-up sheets are available in the main office.',
                teacherId: teachers[2].id,
                classId: englishClass.id,
                createdAt: new Date(now.getTime() - 12 * 60 * 60 * 1000),
            }
        }),
    ]);

    // 12. Create events/calendar items (lots for Michael Chen's week of Oct 7)
    const oct7 = new Date('2025-10-07T08:00:00');
    const oct8 = new Date('2025-10-08T08:00:00');
    const oct9 = new Date('2025-10-09T08:00:00');
    const oct10 = new Date('2025-10-10T08:00:00');
    const oct11 = new Date('2025-10-11T08:00:00');
    
    await Promise.all([
        // Monday Oct 7 - Michael Chen's busy day
        prisma.event.create({
            data: {
                name: 'AP Calculus BC - Period 2',
                startTime: new Date('2025-10-07T09:15:00'),
                endTime: new Date('2025-10-07T10:05:00'),
                location: 'Room 156',
                remarks: 'Derivatives unit test review',
                userId: teachers[1].id,
                classId: mathClass.id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Department Head Meeting',
                startTime: new Date('2025-10-07T10:30:00'),
                endTime: new Date('2025-10-07T11:30:00'),
                location: 'Conference Room A',
                remarks: 'Monthly math department meeting - curriculum planning',
                userId: teachers[1].id,
                color: '#8B5CF6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'AP Statistics - Period 5',
                startTime: new Date('2025-10-07T13:45:00'),
                endTime: new Date('2025-10-07T14:35:00'),
                location: 'Room 156',
                remarks: 'Hypothesis testing introduction',
                userId: teachers[1].id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Parent Conference - Williams Family',
                startTime: new Date('2025-10-07T15:00:00'),
                endTime: new Date('2025-10-07T15:30:00'),
                location: 'Room 156',
                remarks: 'Discuss Sophia\'s progress in AP Calculus',
                userId: teachers[1].id,
                color: '#F59E0B',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Math Tutoring Session',
                startTime: new Date('2025-10-07T15:45:00'),
                endTime: new Date('2025-10-07T16:45:00'),
                location: 'Room 156',
                remarks: 'Extra help for struggling students',
                userId: teachers[1].id,
                color: '#10B981',
            }
        }),

        // Tuesday Oct 8
        prisma.event.create({
            data: {
                name: 'AP Calculus BC - Period 2',
                startTime: new Date('2025-10-08T09:15:00'),
                endTime: new Date('2025-10-08T10:05:00'),
                location: 'Room 156',
                remarks: 'Derivatives unit test',
                userId: teachers[1].id,
                classId: mathClass.id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Faculty Meeting',
                startTime: new Date('2025-10-08T12:00:00'),
                endTime: new Date('2025-10-08T13:00:00'),
                location: 'Main Auditorium',
                remarks: 'All-school faculty meeting',
                userId: teachers[1].id,
                color: '#6B7280',
            }
        }),
        prisma.event.create({
            data: {
                name: 'AP Statistics - Period 5',
                startTime: new Date('2025-10-08T13:45:00'),
                endTime: new Date('2025-10-08T14:35:00'),
                location: 'Room 156',
                remarks: 'Hypothesis testing practice problems',
                userId: teachers[1].id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Grade Level Team Meeting',
                startTime: new Date('2025-10-08T15:00:00'),
                endTime: new Date('2025-10-08T16:00:00'),
                location: 'Room 201',
                remarks: '11th grade team coordination',
                userId: teachers[1].id,
                color: '#8B5CF6',
            }
        }),

        // Wednesday Oct 9
        prisma.event.create({
            data: {
                name: 'AP Calculus BC - Period 2',
                startTime: new Date('2025-10-09T09:15:00'),
                endTime: new Date('2025-10-09T10:05:00'),
                location: 'Room 156',
                remarks: 'Integration introduction',
                userId: teachers[1].id,
                classId: mathClass.id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Professional Development',
                startTime: new Date('2025-10-09T11:00:00'),
                endTime: new Date('2025-10-09T12:30:00'),
                location: 'Library Conference Room',
                remarks: 'Technology in Mathematics Education workshop',
                userId: teachers[1].id,
                color: '#059669',
            }
        }),
        prisma.event.create({
            data: {
                name: 'AP Statistics - Period 5',
                startTime: new Date('2025-10-09T13:45:00'),
                endTime: new Date('2025-10-09T14:35:00'),
                location: 'Room 156',
                remarks: 'Chi-square tests',
                userId: teachers[1].id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Student Council Advisory',
                startTime: new Date('2025-10-09T15:00:00'),
                endTime: new Date('2025-10-09T16:00:00'),
                location: 'Room 105',
                remarks: 'Advisor meeting for student council',
                userId: teachers[1].id,
                color: '#DC2626',
            }
        }),

        // Thursday Oct 10
        prisma.event.create({
            data: {
                name: 'AP Calculus BC - Period 2',
                startTime: new Date('2025-10-10T09:15:00'),
                endTime: new Date('2025-10-10T10:05:00'),
                location: 'Room 156',
                remarks: 'Integration by substitution',
                userId: teachers[1].id,
                classId: mathClass.id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Curriculum Committee',
                startTime: new Date('2025-10-10T11:00:00'),
                endTime: new Date('2025-10-10T12:00:00'),
                location: 'Principal\'s Office',
                remarks: 'Review new AP curriculum standards',
                userId: teachers[1].id,
                color: '#8B5CF6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'AP Statistics - Period 5',
                startTime: new Date('2025-10-10T13:45:00'),
                endTime: new Date('2025-10-10T14:35:00'),
                location: 'Room 156',
                remarks: 'ANOVA introduction',
                userId: teachers[1].id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Parent Conference - Anderson Family',
                startTime: new Date('2025-10-10T15:00:00'),
                endTime: new Date('2025-10-10T15:30:00'),
                location: 'Room 156',
                remarks: 'Discuss Ethan\'s improvement strategies',
                userId: teachers[1].id,
                color: '#F59E0B',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Math Club Meeting',
                startTime: new Date('2025-10-10T15:45:00'),
                endTime: new Date('2025-10-10T16:45:00'),
                location: 'Room 156',
                remarks: 'Preparing for state math competition',
                userId: teachers[1].id,
                color: '#10B981',
            }
        }),

        // Friday Oct 11
        prisma.event.create({
            data: {
                name: 'AP Calculus BC - Period 2',
                startTime: new Date('2025-10-11T09:15:00'),
                endTime: new Date('2025-10-11T10:05:00'),
                location: 'Room 156',
                remarks: 'Integration by parts',
                userId: teachers[1].id,
                classId: mathClass.id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'IEP Meeting - Student Support',
                startTime: new Date('2025-10-11T10:30:00'),
                endTime: new Date('2025-10-11T11:30:00'),
                location: 'Special Services Office',
                remarks: 'Individualized Education Plan review',
                userId: teachers[1].id,
                color: '#F59E0B',
            }
        }),
        prisma.event.create({
            data: {
                name: 'AP Statistics - Period 5',
                startTime: new Date('2025-10-11T13:45:00'),
                endTime: new Date('2025-10-11T14:35:00'),
                location: 'Room 156',
                remarks: 'ANOVA practice and review',
                userId: teachers[1].id,
                color: '#3B82F6',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Weekend Prep Session',
                startTime: new Date('2025-10-11T15:00:00'),
                endTime: new Date('2025-10-11T17:00:00'),
                location: 'Room 156',
                remarks: 'Voluntary AP exam prep session',
                userId: teachers[1].id,
                color: '#059669',
            }
        }),

        // Some events for other teachers too
        prisma.event.create({
            data: {
                name: 'Cell Biology Lab',
                startTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
                endTime: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000), // 90 minutes
                location: 'Science Lab Room 204',
                remarks: 'Bring lab notebooks and safety goggles',
                userId: teachers[0].id,
                classId: biologyClass.id,
                color: '#10B981',
            }
        }),
        prisma.event.create({
            data: {
                name: 'Poetry Reading',
                startTime: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
                endTime: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000),
                location: 'Library',
                remarks: 'Students will present their original poetry',
                userId: teachers[2].id,
                classId: englishClass.id,
                color: '#8B5CF6',
            }
        }),
    ]);

    // 13. Create attendance records
    const attendanceDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await Promise.all([
        prisma.attendance.create({
            data: {
                date: attendanceDate,
                classId: biologyClass.id,
                present: { connect: students.slice(0, 6).map(s => ({ id: s.id })) },
                late: { connect: [{ id: students[6].id }] },
                absent: { connect: [{ id: students[7].id }] },
            }
        }),
        prisma.attendance.create({
            data: {
                date: attendanceDate,
                classId: mathClass.id,
                present: { connect: students.slice(4, 11).map(s => ({ id: s.id })) },
                late: { connect: [{ id: students[11].id }] },
            }
        }),
    ]);

    // 14. Create notifications for realistic teacher experience
    await Promise.all([
        // For main teacher (Sarah Johnson)
        addNotification(teachers[0].id, 'New Submission', 'Alex Martinez submitted Genetics Problem Set'),
        addNotification(teachers[0].id, 'Grade Reminder', 'You have 3 assignments pending grading'),
        addNotification(teachers[0].id, 'Lab Equipment', 'Microscopes for tomorrow\'s lab are ready in Room 204'),
        addNotification(teachers[0].id, 'Parent Contact', 'Mrs. Williams requested a meeting about Sophia\'s progress'),
        
        // For students
        addNotification(students[0].id, 'Assignment Graded', 'Your Genetics Problem Set has been graded: 45/50'),
        addNotification(students[1].id, 'Assignment Graded', 'Your Genetics Problem Set has been graded: 48/50'),
        addNotification(students[2].id, 'Assignment Due', 'Cell Structure Lab Report is due in 3 days'),
        addNotification(students[3].id, 'Class Announcement', 'New announcement in AP Biology'),
    ]);

    // 15. Create some lab chats for AI demo
    const labChatContext = JSON.stringify({
        subject: 'Biology',
        topic: 'Cell Structure and Function',
        gradeLevel: '11th Grade AP',
        difficulty: 'Advanced',
        objectives: [
            'Understand prokaryotic vs eukaryotic cell structures',
            'Identify organelles and their functions',
            'Compare plant and animal cells'
        ],
        standards: ['NGSS HS-LS1-1', 'NGSS HS-LS1-2'],
        duration: '2 weeks',
        assessmentType: 'Lab report and quiz'
    });

    // Create conversation for lab chat
    const labConversation = await prisma.conversation.create({
        data: {
            type: 'GROUP',
            name: 'Lab: Cell Structure Materials',
            displayInChat: false,
        }
    });

    // Add teacher to conversation
    await prisma.conversationMember.create({
        data: {
            userId: teachers[0].id,
            conversationId: labConversation.id,
            role: 'ADMIN',
        }
    });

    // Create lab chat
    await prisma.labChat.create({
        data: {
            title: 'Cell Structure Teaching Materials',
            context: labChatContext,
            classId: biologyClass.id,
            conversationId: labConversation.id,
            createdById: teachers[0].id,
        }
    });

    // 16. Create chat conversations and messages
    // Teacher-to-teacher conversations
    const teacherConversation1 = await prisma.conversation.create({
        data: {
            type: 'GROUP',
            name: 'Math Department Chat',
            displayInChat: true,
        }
    });

    // Add all teachers to department chat
    await Promise.all([
        prisma.conversationMember.create({
            data: {
                userId: teachers[0].id, // Sarah (Biology)
                conversationId: teacherConversation1.id,
                role: 'MEMBER',
            }
        }),
        prisma.conversationMember.create({
            data: {
                userId: teachers[1].id, // Michael (Math)
                conversationId: teacherConversation1.id,
                role: 'ADMIN',
            }
        }),
        prisma.conversationMember.create({
            data: {
                userId: teachers[2].id, // Emma (English)
                conversationId: teacherConversation1.id,
                role: 'MEMBER',
            }
        }),
    ]);

    // Teacher-student conversations
    const studentConversation1 = await prisma.conversation.create({
        data: {
            type: 'DM',
            name: null,
            displayInChat: true,
        }
    });

    await Promise.all([
        prisma.conversationMember.create({
            data: {
                userId: teachers[1].id, // Michael Chen
                conversationId: studentConversation1.id,
                role: 'MEMBER',
            }
        }),
        prisma.conversationMember.create({
            data: {
                userId: students[4].id, // Ethan Anderson
                conversationId: studentConversation1.id,
                role: 'MEMBER',
            }
        }),
    ]);

    const studentConversation2 = await prisma.conversation.create({
        data: {
            type: 'DM',
            name: null,
            displayInChat: true,
        }
    });

    await Promise.all([
        prisma.conversationMember.create({
            data: {
                userId: teachers[1].id, // Michael Chen
                conversationId: studentConversation2.id,
                role: 'MEMBER',
            }
        }),
        prisma.conversationMember.create({
            data: {
                userId: students[1].id, // Sophia Williams
                conversationId: studentConversation2.id,
                role: 'MEMBER',
            }
        }),
    ]);

    // Create messages in conversations
    const chatMessages = [
        // Teacher department chat messages
        {
            content: 'Hey everyone! Hope you all had a great weekend. Quick reminder about the faculty meeting tomorrow at noon.',
            senderId: teachers[1].id,
            conversationId: teacherConversation1.id,
            createdAt: new Date('2024-10-07T07:30:00'),
        },
        {
            content: 'Thanks for the reminder, Michael! I\'ll be there. Are we discussing the new curriculum standards?',
            senderId: teachers[0].id,
            conversationId: teacherConversation1.id,
            createdAt: new Date('2024-10-07T07:45:00'),
        },
        {
            content: 'Yes, among other things. Also wanted to coordinate on the parent-teacher conferences next week.',
            senderId: teachers[1].id,
            conversationId: teacherConversation1.id,
            createdAt: new Date('2024-10-07T08:00:00'),
        },
        {
            content: 'Perfect timing! I have several parents asking about their kids\' progress in my English classes.',
            senderId: teachers[2].id,
            conversationId: teacherConversation1.id,
            createdAt: new Date('2024-10-07T08:15:00'),
        },
        {
            content: 'The integration unit is going well in AP Calc. Students seem to be grasping the concepts better this year.',
            senderId: teachers[1].id,
            conversationId: teacherConversation1.id,
            createdAt: new Date('2024-10-08T16:30:00'),
        },
        {
            content: 'That\'s great to hear! I\'ve been incorporating more hands-on labs in biology and seeing similar improvements.',
            senderId: teachers[0].id,
            conversationId: teacherConversation1.id,
            createdAt: new Date('2024-10-08T16:45:00'),
        },
        {
            content: 'Anyone free for coffee after school tomorrow? Would love to chat about cross-curricular projects.',
            senderId: teachers[2].id,
            conversationId: teacherConversation1.id,
            createdAt: new Date('2024-10-09T14:00:00'),
        },
        {
            content: 'I\'m in! Math Club ends at 4:45, so anytime after 5 works for me.',
            senderId: teachers[1].id,
            conversationId: teacherConversation1.id,
            createdAt: new Date('2024-10-09T14:15:00'),
        },

        // Michael Chen with Ethan Anderson (struggling student)
        {
            content: 'Hi Mr. Chen, I\'m really struggling with the integration problems from today\'s class. Could you help explain substitution method again?',
            senderId: students[4].id,
            conversationId: studentConversation1.id,
            createdAt: new Date('2024-10-09T15:30:00'),
        },
        {
            content: 'Of course, Ethan! I\'m glad you reached out. The key is identifying what to substitute. Can you tell me which problem you\'re stuck on specifically?',
            senderId: teachers[1].id,
            conversationId: studentConversation1.id,
            createdAt: new Date('2024-10-09T15:45:00'),
        },
        {
            content: 'Problem #7 from the homework. I don\'t know how to choose what u should equal.',
            senderId: students[4].id,
            conversationId: studentConversation1.id,
            createdAt: new Date('2024-10-09T16:00:00'),
        },
        {
            content: 'Great question! For u-substitution, look for a function whose derivative also appears in the integral. In #7, try setting u equal to the expression inside the parentheses. What do you get when you differentiate that?',
            senderId: teachers[1].id,
            conversationId: studentConversation1.id,
            createdAt: new Date('2024-10-09T16:15:00'),
        },
        {
            content: 'Oh! So u = 2x + 1, and du = 2dx? That means I need to adjust for the 2...',
            senderId: students[4].id,
            conversationId: studentConversation1.id,
            createdAt: new Date('2024-10-09T17:00:00'),
        },
        {
            content: 'Exactly! You\'ve got it. Remember to substitute back at the end. Feel free to come to tutoring tomorrow if you need more practice.',
            senderId: teachers[1].id,
            conversationId: studentConversation1.id,
            createdAt: new Date('2024-10-09T17:15:00'),
        },
        {
            content: 'Thank you so much! This makes way more sense now. I\'ll definitely come to tutoring.',
            senderId: students[4].id,
            conversationId: studentConversation1.id,
            createdAt: new Date('2024-10-09T17:30:00'),
        },

        // Michael Chen with Sophia Williams (high-achieving student)
        {
            content: 'Hi Mr. Chen! I finished the integration homework early. Are there any extra challenge problems I could work on?',
            senderId: students[1].id,
            conversationId: studentConversation2.id,
            createdAt: new Date('2024-10-10T19:00:00'),
        },
        {
            content: 'Sophia, I love your enthusiasm! Try problems 45-50 from chapter 6. They involve integration by parts, which we\'ll cover next week.',
            senderId: teachers[1].id,
            conversationId: studentConversation2.id,
            createdAt: new Date('2024-10-10T19:30:00'),
        },
        {
            content: 'Perfect! I looked ahead in the textbook and the integration by parts formula looks interesting. Is it similar to the product rule for derivatives?',
            senderId: students[1].id,
            conversationId: studentConversation2.id,
            createdAt: new Date('2024-10-10T20:00:00'),
        },
        {
            content: 'You\'re absolutely right! Integration by parts is essentially the reverse of the product rule. You have a great mathematical intuition.',
            senderId: teachers[1].id,
            conversationId: studentConversation2.id,
            createdAt: new Date('2024-10-10T20:15:00'),
        },
        {
            content: 'Also, I wanted to ask about the Math Club competition. What topics should I focus on for preparation?',
            senderId: students[1].id,
            conversationId: studentConversation2.id,
            createdAt: new Date('2024-10-11T12:00:00'),
        },
        {
            content: 'Great question! Focus on algebra, geometry, and basic calculus. I\'ll have practice problems ready for tomorrow\'s Math Club meeting.',
            senderId: teachers[1].id,
            conversationId: studentConversation2.id,
            createdAt: new Date('2024-10-11T12:30:00'),
        },
    ];

    // Create all messages
    await Promise.all(chatMessages.map(message => 
        prisma.message.create({ data: message })
    ));

    // 16. Create file structure for classes
    await Promise.all([
        prisma.folder.create({
            data: {
                name: 'Class Files',
                classId: biologyClass.id,
                color: '#10B981',
            }
        }),
        prisma.folder.create({
            data: {
                name: 'Class Files',
                classId: mathClass.id,
                color: '#3B82F6',
            }
        }),
        prisma.folder.create({
            data: {
                name: 'Class Files',
                classId: englishClass.id,
                color: '#8B5CF6',
            }
        }),
    ]);

    logger.info('✅ Comprehensive demo database seeded successfully!');
    logger.info('📚 Created:');
    logger.info('  - 1 School (Riverside High School)');
    logger.info('  - 3 Teachers with detailed profiles');
    logger.info('  - 12 Students with profiles');
    logger.info('  - 3 Classes (AP Biology, AP Calculus BC, English Literature)');
    logger.info('  - 7 Course sections with color coding');
    logger.info('  - 2 Mark schemes with detailed rubrics');
    logger.info('  - 1 Grading boundary with weighted categories');
    logger.info('  - 9 Assignments (6 for Calc BC demo class)');
    logger.info('  - 64+ Student submissions with realistic grades & comments');
    logger.info('  - 3 Announcements from different teachers');
    logger.info('  - 3 Calendar events');
    logger.info('  - Attendance records with present/late/absent tracking');
    logger.info('  - 1 Lab chat for AI demo');
    logger.info('  - Multiple realistic notifications');
    logger.info('  - File organization structure');
    logger.info('');
    logger.info('🎯 AP Calculus BC Class (Demo Focus):');
    logger.info('  - 6 assignments with varied due dates');
    logger.info('  - Complete mark scheme & grading boundaries');
    logger.info('  - All 8 students have submissions to all assignments');
    logger.info('  - Realistic grade distribution & teacher feedback');
    logger.info('  - Rubric-based grading with detailed breakdowns');
    logger.info('');
    logger.info('🎬 Demo accounts:');
    logger.info('  Main Teacher: sarah.johnson@riverside.edu / demo123');
    logger.info('  Math Teacher: michael.chen@riverside.edu / demo123');
    logger.info('  English Teacher: emma.davis@riverside.edu / demo123');
    logger.info('  Student: alex.martinez@student.riverside.edu / student123');
};

(async () => {
    logger.info('Seeding database');
    await seedDatabase();
    logger.info('Database seeded');
})();