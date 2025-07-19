import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, serverTimestamp, updateDoc, doc, getDoc, writeBatch, getDocs, deleteDoc } from 'firebase/firestore';

// Define global variables for Firebase configuration and app ID, provided by the Canvas environment.
// If not defined (e.g., during local development), fall back to default values.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-inventory-app';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- IMPORTANT SECURITY WARNING ---
// For demonstration purposes in this environment, a simple hardcoded password is used.
// This is HIGHLY INSECURE for real-world applications.
// In a production system, you MUST use a robust authentication mechanism (e.g., Firebase Authentication
// with email/password, Google Sign-In, etc.) and never hardcode passwords.
const ACCESS_PASSWORD = "rolexpassword"; // Replace with a strong, securely managed password in production
// --- END SECURITY WARNING ---

// Helper function to parse size strings (e.g., "1-1/2"", "3/4"", "10"") into numbers for correct sorting.
const parseSizeToNumber = (sizeStr) => {
    if (typeof sizeStr !== 'string') return 0;
    const cleanStr = sizeStr.replace(/"/g, '').trim();

    // Handle mixed numbers like "1-1/4"
    if (cleanStr.includes('-') && cleanStr.includes('/')) {
        const parts = cleanStr.split('-');
        const integerPart = parseFloat(parts[0]);
        const fractionParts = parts[1].split('/');
        const fractionalPart = parseFloat(fractionParts[0]) / parseFloat(fractionParts[1]);
        return integerPart + fractionalPart;
    }
    
    // Handle fractions like "1/2"
    if (cleanStr.includes('/')) {
        const parts = cleanStr.split('/');
        return parseFloat(parts[0]) / parseFloat(parts[1]);
    }

    // Handle regular numbers
    return parseFloat(cleanStr) || 0;
};


// Predefined master data lists
const predefinedCategories = [
    "SR ELBOW", "LR ELBOW", "45 ELBOW", "EQUAL TEE", "UNEQUAL TEE",
    "CON RED", "ECC RED", "STUBEND", "CAP"
];
const predefinedGrades = [
    "304", "304H", "316", "321", "316TI", "DUPLEX2205", "DUPLEX31803",
    "SUPERDUPLEX32750", "SUPERDUPLEXZ32760", "INCONEL625", "TITANIUM"
];
const predefinedSizes = [
    "1/2\"", "3/4\"", "1\"", "1-1/4\"", "1-1/2\"", "2\"", "2-1/2\"", "3\"", "4\"",
    "6\"", "8\"", "10\"", "12\"", "14\"", "16\"", "18\"", "20\"", "24\"", "22\"",
    "26\"", "28\"", "30\"", "32\"", "36\"", "40\"", "42\""
];
const predefinedSchedules = [
    "S10", "S10S", "S5", "S40", "S40S", "S80", "S80S", "S120", "S100", "S160",
    "XXS", "S20", "S40SXS80S", "S40SXSCH10S", "S60XS80", "S60XS40", "S10XS40",
    "S40XS10", "S80XS40", "XXS X 160", "S30XS10S", "S20XS40", "S40XS160",
    "S80SXS40S", "S20XS10", "S40SXS20", "S30", "S80SXS20", "S60", "S20XS10"
];
const predefinedOrigins = ["IMPORTED", "CHINA", "INDIAN"];
const predefinedSeamConditions = ["SEAMLESS", "PW", "2JOINT"];
const predefinedLocations = ["TALOJA GODOWN", "DONGRI GODOWN", "OFFICE GODOWN"];

// Categories that require two size options
const dualSizeCategories = ["UNEQUAL TEE", "CON RED", "ECC RED"];

// Reusable Select Input Component
const SelectField = ({ label, id, value, onChange, options, placeholder, onAddClick, showAddButton = true, disabled = false }) => (
    <div className="flex flex-col">
        <label htmlFor={id} className="text-gray-700 font-medium mb-1">{label}</label>
        <div className="flex items-center space-x-2">
            <select
                id={id}
                value={value}
                onChange={(e) => {
                    if (e && e.target && onChange) {
                        onChange(e.target.value);
                    } else {
                        console.error("SelectField: Event, event.target, or onChange prop is undefined.", { e, onChange });
                    }
                }}
                className={`flex-grow p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 ${disabled ? 'bg-gray-200 cursor-not-allowed' : 'bg-white'}`}
                disabled={disabled}
            >
                <option value="" disabled>{placeholder}</option>
                {options.map((option, index) => (
                    <option key={index} value={option}>{option}</option>
                ))}
            </select>
            {showAddButton && onAddClick && (
                <button
                    onClick={onAddClick}
                    type="button"
                    className="p-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors duration-200"
                    title={`Add New ${label}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                </button>
            )}
        </div>
    </div>
);

// Reusable Text/Number Input Component
const InputField = ({ label, id, type = 'text', value, onChange, placeholder, rows, readOnly = false }) => (
    <div className="flex flex-col">
        <label htmlFor={id} className="text-gray-700 font-medium mb-1">{label}</label>
        {type === 'textarea' ? (
            <textarea
                id={id}
                value={value}
                onChange={(e) => {
                    if (e && e.target && onChange) {
                        onChange(e.target.value);
                    } else {
                        console.error("InputField (textarea): Event, event.target, or onChange prop is undefined.", { e, onChange });
                    }
                }}
                rows={rows}
                className={`p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 ${readOnly ? 'bg-gray-200' : ''}`}
                placeholder={placeholder}
                readOnly={readOnly}
            />
        ) : (
            <input
                type={type}
                id={id}
                value={value}
                onChange={(e) => {
                    if (e && e.target && onChange) {
                        onChange(e.target.value);
                    } else {
                        console.error("InputField (input): Event, event.target, or onChange prop is undefined.", { e, onChange });
                    }
                }}
                className={`p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 ${readOnly ? 'bg-gray-200' : ''}`}
                placeholder={placeholder}
                readOnly={readOnly}
            />
        )}
    </div>
);


function App() {
    // Authentication states
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [passwordInput, setPasswordInput] = useState('');
    const [authError, setAuthError] = useState('');

    // State variables for Firebase and user authentication
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // State for inventory form (used for IN/OUT)
    const initialFormState = {
        category: '',
        grade: '',
        size: '',
        size1: '',
        size2: '',
        schedule: '',
        origin: '',
        seamCondition: '',
        quantity: '',
        date: new Date().toISOString().split('T')[0],
        remarks: '',
        location: '',
        selectedBatchId: '',
        entryBy: ''
    };
    const [formState, setFormState] = useState(initialFormState);

    // State variables for master data lists (fetched from Firestore)
    const [categories, setCategories] = useState([]);
    const [grades, setGrades] = useState([]);
    const [sizes, setSizes] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [locations, setLocations] = useState([]);

    // State variables for inventory records and batches
    const [inventoryRecords, setInventoryRecords] = useState([]); // All IN/OUT transactions
    const [batches, setBatches] = useState([]); // All active/inactive batches

    const [searchQuery, setSearchQuery] = useState('');
    const [currentView, setCurrentView] = useState('inventory'); // 'inventory', 'reports'

    // State variables for reports section filters
    const [reportCategoryFilter, setReportCategoryFilter] = useState('');
    const [reportGradeFilter, setReportGradeFilter] = useState('');
    const [reportSizeFilter, setReportSizeFilter] = useState('');
    const [reportScheduleFilter, setReportScheduleFilter] = useState('');
    const [reportOriginFilter, setReportOriginFilter] = useState('');
    const [reportSeamConditionFilter, setReportSeamConditionFilter] = useState('');
    const [reportLocationFilter, setReportLocationFilter] = useState('');

    // State variables for modals
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [selectedItemForHistory, setSelectedItemForHistory] = useState(null);
    const [showAdjustBatchModal, setShowAdjustBatchModal] = useState(false);
    const [batchToAdjustInModal, setBatchToAdjustInModal] = useState(null);
    const [showTransferBatchModal, setShowTransferBatchModal] = useState(false);
    const [batchToTransferInModal, setBatchToTransferInModal] = useState(null);
    const [showEditTransactionModal, setShowEditTransactionModal] = useState(false);
    const [transactionToEdit, setTransactionToEdit] = useState(null);
    const [showEditBatchModal, setShowEditBatchModal] = useState(false);
    const [batchToEditInModal, setBatchToEditInModal] = useState(null);
    const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
    const [transactionToDelete, setTransactionToDelete] = useState(null);
    const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [showAddGradeModal, setShowAddGradeModal] = useState(false);
    const [newGradeName, setNewGradeName] = useState('');
    const [showAddSizeModal, setShowAddSizeModal] = useState(false);
    const [newSizeName, setNewSizeName] = useState('');
    const [showAddScheduleModal, setShowAddScheduleModal] = useState(false);
    const [newScheduleName, setNewScheduleName] = useState('');
    const [showAddLocationModal, setShowAddLocationModal] = useState(false);
    const [newLocationName, setNewLocationName] = useState('');
    
    // Gemini API states
    const [reportSummary, setReportSummary] = useState('');
    const [isSummaryLoading, setIsSummaryLoading] = useState(false);


    const [message, setMessage] = useState({ text: '', type: '' }); // type: 'success', 'error'
    const messageTimeoutRef = useRef(null);

    // Function to show messages to the user
    const showMessage = (text, type) => {
        setMessage({ text, type });
        if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
        messageTimeoutRef.current = setTimeout(() => setMessage({ text: '', type: '' }), 5000);
    };

    // Firebase Initialization and Authentication
    useEffect(() => {
        if (!firebaseConfig.apiKey) {
            console.error("Firebase config is missing. Please ensure __firebase_config is provided.");
            setIsAuthReady(true);
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const firestoreInstance = getFirestore(app);
            setAuth(authInstance);
            setDb(firestoreInstance);

            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(authInstance, initialAuthToken);
                        } else {
                            await signInAnonymously(authInstance);
                        }
                    } catch (error) {
                        console.error("Authentication failed:", error);
                        await signInAnonymously(authInstance); // Fallback to anonymous
                    }
                }
                setIsAuthReady(true);
            });
            return () => unsubscribe();
        } catch (error) {
            console.error("Error initializing Firebase:", error);
            setIsAuthReady(true);
        }
    }, []);

    // Handle password submission
    const handlePasswordSubmit = (e) => {
        e.preventDefault();
        if (passwordInput === ACCESS_PASSWORD) {
            setIsAuthenticated(true);
            setAuthError('');
        } else {
            setAuthError('Incorrect password. Please try again.');
        }
    };

    // Fetch master data (categories, grades, sizes, etc.)
    useEffect(() => {
        if (!db || !userId || !isAuthenticated) return;

        const setupMasterDataListener = (collectionName, setFunction, predefinedData, setFormStateField) => {
            const q = query(collection(db, `artifacts/${appId}/public/data/${collectionName}`));
            return onSnapshot(q, async (snapshot) => {
                let items = snapshot.docs.map(doc => doc.data().name);
                
                if (items.length === 0 && predefinedData.length > 0) {
                    const batch = writeBatch(db);
                    const dataToCommit = [...predefinedData];
                    
                    if (collectionName === 'sizes') {
                        dataToCommit.sort((a, b) => parseSizeToNumber(a) - parseSizeToNumber(b));
                    }

                    for (const item of dataToCommit) {
                        const docRef = doc(collection(db, `artifacts/${appId}/public/data/${collectionName}`));
                        batch.set(docRef, { name: item });
                    }
                    await batch.commit();
                    items = dataToCommit;
                }

                if (collectionName === 'sizes') {
                    items.sort((a, b) => parseSizeToNumber(a) - parseSizeToNumber(b));
                }
                
                setFunction(items);

                if (setFormStateField) {
                    setFormState(prev => ({ ...prev, [setFormStateField]: prev[setFormStateField] || items[0] || '' }));
                }
            }, (error) => console.error(`Error fetching ${collectionName}:`, error));
        };

        const unsubscribers = [
            setupMasterDataListener('categories', setCategories, predefinedCategories, 'category'),
            setupMasterDataListener('grades', setGrades, predefinedGrades, 'grade'),
            setupMasterDataListener('sizes', setSizes, predefinedSizes, 'size'),
            setupMasterDataListener('schedules', setSchedules, predefinedSchedules, 'schedule'),
            setupMasterDataListener('locations', setLocations, predefinedLocations, 'location'),
        ];
        
        setFormState(prev => ({
            ...prev,
            origin: prev.origin || predefinedOrigins[0],
            seamCondition: prev.seamCondition || predefinedSeamConditions[0]
        }));

        return () => unsubscribers.forEach(unsub => unsub());
    }, [db, userId, isAuthenticated]);

    // Fetch inventory records and batches
    useEffect(() => {
        if (!db || !userId || !isAuthenticated) return;

        const recordsQuery = query(collection(db, `artifacts/${appId}/public/data/inventory_records`));
        const unsubscribeRecords = onSnapshot(recordsQuery, (snapshot) => {
            const records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setInventoryRecords(records);
        }, (error) => console.error("Error fetching inventory records:", error));

        const batchesQuery = query(collection(db, `artifacts/${appId}/public/data/batches`));
        const unsubscribeBatches = onSnapshot(batchesQuery, (snapshot) => {
            const fetchedBatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setBatches(fetchedBatches);
        }, (error) => console.error("Error fetching batches:", error));

        return () => {
            unsubscribeRecords();
            unsubscribeBatches();
        };
    }, [db, userId, isAuthenticated]);

    // Handle adding new master data
    const handleAddMasterData = async (collectionName, itemName, newItemName, setShowModal, setNewItemName) => {
        if (!db || !userId || !newItemName.trim()) {
            showMessage('Please enter a valid name.', 'error');
            return;
        }
        try {
            const collectionRef = collection(db, `artifacts/${appId}/public/data/${collectionName}`);
            await addDoc(collectionRef, { name: newItemName.trim() });
            showMessage(`${itemName} "${newItemName.trim()}" added successfully!`, 'success');
            setShowModal(false);
            setNewItemName('');
        } catch (error) {
            console.error(`Error adding new ${itemName}:`, error);
            showMessage(`Failed to add new ${itemName}.`, 'error');
        }
    };

    // Reset form to its initial state
    const resetForm = () => {
        setFormState({
            ...initialFormState,
            entryBy: formState.entryBy,
            category: categories[0] || '',
            grade: grades[0] || '',
            size: sizes[0] || '',
            size1: sizes[0] || '',
            size2: sizes[0] || '',
            schedule: schedules[0] || '',
            origin: predefinedOrigins[0] || '',
            seamCondition: predefinedSeamConditions[0] || '',
            location: locations[0] || '',
        });
    };

    // Handle inventory IN/OUT
    const handleInventoryTransaction = async (type) => {
        if (!db || !userId) {
            showMessage('Authentication required.', 'error');
            return;
        }
        
        const { category, grade, size, size1, size2, schedule, origin, seamCondition, quantity, date, location, entryBy, selectedBatchId, remarks } = formState;

        const isDualSize = dualSizeCategories.includes(category);
        const commonFieldsFilled = category && grade && schedule && origin && seamCondition && quantity && date && location && entryBy.trim();
        const sizeFieldsFilled = isDualSize ? (size1 && size2) : size;

        if (!commonFieldsFilled || !sizeFieldsFilled) {
            showMessage('Please fill in all required fields, including "Entry By".', 'error');
            return;
        }

        const parsedQuantity = parseInt(quantity);
        if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
            showMessage('Quantity must be a positive number.', 'error');
            return;
        }

        try {
            if (type === 'IN') {
                const batchData = {
                    category, grade, schedule, origin, seamCondition, location,
                    initialQuantity: parsedQuantity,
                    currentQuantity: parsedQuantity,
                    inDate: date,
                    remarks: remarks || '',
                    entryBy: entryBy.trim(),
                    timestamp: serverTimestamp(),
                    ...(isDualSize ? { size1, size2 } : { size })
                };
                const newBatchRef = await addDoc(collection(db, `artifacts/${appId}/public/data/batches`), batchData);

                const recordData = {
                    ...batchData,
                    quantity: parsedQuantity,
                    type: 'IN',
                    batchId: newBatchRef.id,
                };
                await addDoc(collection(db, `artifacts/${appId}/public/data/inventory_records`), recordData);
                showMessage(`Inventory IN successful! New batch created.`, 'success');

            } else if (type === 'OUT') {
                if (!selectedBatchId) {
                    showMessage('Please select a batch to deduct from.', 'error');
                    return;
                }
                const batchToUpdate = batches.find(b => b.id === selectedBatchId);
                if (!batchToUpdate) {
                    showMessage('Selected batch not found.', 'error');
                    return;
                }
                if (parsedQuantity > batchToUpdate.currentQuantity) {
                    showMessage(`Cannot deduct ${parsedQuantity}. Only ${batchToUpdate.currentQuantity} available.`, 'error');
                    return;
                }

                const batchDocRef = doc(db, `artifacts/${appId}/public/data/batches`, selectedBatchId);
                await updateDoc(batchDocRef, {
                    currentQuantity: batchToUpdate.currentQuantity - parsedQuantity
                });

                const recordData = {
                    category: batchToUpdate.category,
                    grade: batchToUpdate.grade,
                    schedule: batchToUpdate.schedule,
                    origin: batchToUpdate.origin,
                    seamCondition: batchToUpdate.seamCondition,
                    location: batchToUpdate.location,
                    quantity: -parsedQuantity,
                    date,
                    remarks: remarks || '',
                    type: 'OUT',
                    batchId: selectedBatchId,
                    entryBy: entryBy.trim(),
                    timestamp: serverTimestamp(),
                    ...(dualSizeCategories.includes(batchToUpdate.category) ? { size1: batchToUpdate.size1, size2: batchToUpdate.size2 } : { size: batchToUpdate.size })
                };
                await addDoc(collection(db, `artifacts/${appId}/public/data/inventory_records`), recordData);
                showMessage(`Inventory OUT successful from selected batch.`, 'success');
            }
            
            // Instead of resetting the whole form, just clear transaction-specific fields
            setFormState(prevState => ({
                ...prevState,
                quantity: '',
                remarks: '',
                selectedBatchId: '',
                date: new Date().toISOString().split('T')[0] // Reset date to today
            }));

        } catch (error) {
            console.error(`Error processing inventory ${type} transaction:`, error);
            showMessage(`Failed to process inventory ${type}.`, 'error');
        }
    };
    
    // Handler to populate form fields from a transaction record
    const handleTransactionRowDoubleClick = (record) => {
        setFormState(prevState => ({
            ...prevState, // Keep existing 'entryBy', 'date' etc.
            category: record.category || '',
            grade: record.grade || '',
            size: record.size || '',
            size1: record.size1 || '',
            size2: record.size2 || '',
            schedule: record.schedule || '',
            origin: record.origin || '',
            seamCondition: record.seamCondition || '',
            location: record.location || '',
            // Clear fields that should be manually entered for a new transaction
            quantity: '',
            remarks: '',
            selectedBatchId: ''
        }));
        showMessage('Form populated. Enter new quantity and details.', 'success');
    };


    // Handle saving an edited transaction
    const handleUpdateTransaction = async (updatedRecord, originalRecord) => {
        if (!db) return;

        const { id, batchId, quantity, date, remarks } = updatedRecord;
        const originalQuantity = originalRecord.quantity;

        const newQuantity = parseInt(quantity, 10);
        if (isNaN(newQuantity)) {
            showMessage("Quantity must be a valid number.", "error");
            return;
        }

        const quantityDifference = newQuantity - originalQuantity;

        const recordRef = doc(db, `artifacts/${appId}/public/data/inventory_records`, id);
        const batchRef = doc(db, `artifacts/${appId}/public/data/batches`, batchId);

        try {
            const batchSnap = await getDoc(batchRef);
            if (!batchSnap.exists()) {
                showMessage("Error: Associated batch no longer exists.", "error");
                return;
            }

            const batchData = batchSnap.data();
            const newBatchQuantity = batchData.currentQuantity + quantityDifference;

            if (newBatchQuantity < 0) {
                showMessage(`Edit failed: This change would result in a negative stock of ${newBatchQuantity} for the batch.`, "error");
                return;
            }

            const firestoreBatch = writeBatch(db);
            firestoreBatch.update(recordRef, {
                quantity: newQuantity,
                date,
                remarks,
            });
            firestoreBatch.update(batchRef, {
                currentQuantity: newBatchQuantity
            });

            await firestoreBatch.commit();
            
            showMessage("Transaction updated successfully!", "success");
            setShowEditTransactionModal(false);
            setTransactionToEdit(null);

        } catch (error) {
            console.error("Error updating transaction:", error);
            showMessage("Failed to update transaction.", "error");
        }
    };

    // Function to handle saving batch adjustment
    const handleSaveAdjustment = async (batchId, adjustedQuantity, adjustmentRemarks) => {
        if (!db || !userId) return;
        if (isNaN(adjustedQuantity)) {
            showMessage('Adjustment quantity must be a number.', 'error');
            return;
        }

        try {
            const batchDocRef = doc(db, `artifacts/${appId}/public/data/batches`, batchId);
            const batchToUpdate = batches.find(b => b.id === batchId);
            if (!batchToUpdate) {
                showMessage('Batch not found for adjustment.', 'error');
                return;
            }
            const newQuantity = batchToUpdate.currentQuantity + adjustedQuantity;
            if (newQuantity < 0) {
                showMessage('Adjusted quantity cannot result in a negative stock.', 'error');
                return;
            }

            await updateDoc(batchDocRef, { currentQuantity: newQuantity });

            const recordData = {
                category: batchToUpdate.category,
                grade: batchToUpdate.grade,
                schedule: batchToUpdate.schedule,
                origin: batchToUpdate.origin,
                seamCondition: batchToUpdate.seamCondition,
                location: batchToUpdate.location,
                quantity: adjustedQuantity,
                date: new Date().toISOString().split('T')[0],
                remarks: adjustmentRemarks || 'Quantity adjustment',
                type: 'ADJUSTMENT',
                batchId: batchId,
                entryBy: formState.entryBy.trim(),
                timestamp: serverTimestamp(),
                 ...(dualSizeCategories.includes(batchToUpdate.category) ? { size1: batchToUpdate.size1, size2: batchToUpdate.size2 } : { size: batchToUpdate.size })
            };
            await addDoc(collection(db, `artifacts/${appId}/public/data/inventory_records`), recordData);

            showMessage('Batch adjusted successfully!', 'success');
            setShowAdjustBatchModal(false);
            setBatchToAdjustInModal(null);
        } catch (error) {
            console.error("Error adjusting batch:", error);
            showMessage("Failed to adjust batch.", 'error');
        }
    };

    // Handle Inventory Transfer from Batch Modal
    const handleSaveTransfer = async (sourceBatchId, destinationLocation, transferQuantity, transferRemarks) => {
        if (!db || !userId) return;
        const { entryBy } = formState;

        if (!destinationLocation || !transferQuantity || !entryBy.trim()) {
            showMessage('Please fill in all required transfer fields, including "Entry By".', 'error');
            return;
        }
        const parsedTransferQuantity = parseInt(transferQuantity);
        if (isNaN(parsedTransferQuantity) || parsedTransferQuantity <= 0) {
            showMessage('Transfer quantity must be a positive number.', 'error');
            return;
        }

        const sourceBatch = batches.find(b => b.id === sourceBatchId);
        if (!sourceBatch) {
            showMessage('Source batch not found.', 'error');
            return;
        }
        if (sourceBatch.location === destinationLocation) {
            showMessage('Source and Destination locations cannot be the same.', 'error');
            return;
        }
        if (parsedTransferQuantity > sourceBatch.currentQuantity) {
            showMessage(`Cannot transfer ${parsedTransferQuantity}. Only ${sourceBatch.currentQuantity} available.`, 'error');
            return;
        }

        try {
            const transferId = doc(collection(db, `artifacts/${appId}/public/data/transfers`)).id;
            
            // 1. Update source batch
            const sourceBatchDocRef = doc(db, `artifacts/${appId}/public/data/batches`, sourceBatchId);
            await updateDoc(sourceBatchDocRef, {
                currentQuantity: sourceBatch.currentQuantity - parsedTransferQuantity
            });

            // 2. Create new destination batch
            const newDestinationBatchData = {
                ...sourceBatch,
                location: destinationLocation,
                initialQuantity: parsedTransferQuantity,
                currentQuantity: parsedTransferQuantity,
                inDate: new Date().toISOString().split('T')[0],
                remarks: transferRemarks || `Transferred from ${sourceBatch.location}`,
                entryBy: entryBy.trim(),
                timestamp: serverTimestamp()
            };
            delete newDestinationBatchData.id; // Remove old ID before creating new doc
            const newDestinationBatchRef = await addDoc(collection(db, `artifacts/${appId}/public/data/batches`), newDestinationBatchData);

            // 3. Record TRANSFER_OUT
            const transferOutRecordData = {
                ...sourceBatch,
                quantity: -parsedTransferQuantity,
                date: new Date().toISOString().split('T')[0],
                remarks: transferRemarks || `Transfer OUT to ${destinationLocation}`,
                type: 'TRANSFER_OUT',
                batchId: sourceBatchId,
                transferId,
                entryBy: entryBy.trim(),
                timestamp: serverTimestamp()
            };
            delete transferOutRecordData.id;
            await addDoc(collection(db, `artifacts/${appId}/public/data/inventory_records`), transferOutRecordData);

            // 4. Record TRANSFER_IN
            const transferInRecordData = {
                ...newDestinationBatchData,
                quantity: parsedTransferQuantity,
                remarks: transferRemarks || `Transfer IN from ${sourceBatch.location}`,
                type: 'TRANSFER_IN',
                batchId: newDestinationBatchRef.id,
                transferId,
            };
            await addDoc(collection(db, `artifacts/${appId}/public/data/inventory_records`), transferInRecordData);

            showMessage(`Transfer successful!`, 'success');
            setShowTransferBatchModal(false);
            setBatchToTransferInModal(null);
        } catch (error) {
            console.error("Error processing inventory transfer:", error);
            showMessage(`Failed to process inventory transfer.`, 'error');
        }
    };

    // Handle saving an edited batch's core details
    const handleSaveBatchEdit = async (batchId, updatedData, originalData, editRemarks) => {
        if (!db || !userId) return;

        try {
            const batchDocRef = doc(db, `artifacts/${appId}/public/data/batches`, batchId);
            
            // Create a log of the change
            const editRecord = {
                type: 'EDIT',
                batchId,
                date: new Date().toISOString().split('T')[0],
                entryBy: formState.entryBy.trim() || 'System',
                remarks: editRemarks || 'Batch details updated',
                timestamp: serverTimestamp(),
                originalData,
                updatedData,
                location: updatedData.location, // For filtering
                category: updatedData.category, // For filtering
                grade: updatedData.grade, // For filtering
                quantity: 0 // No quantity change
            };

            const firestoreBatch = writeBatch(db);
            firestoreBatch.update(batchDocRef, updatedData);
            const recordRef = doc(collection(db, `artifacts/${appId}/public/data/inventory_records`));
            firestoreBatch.set(recordRef, editRecord);
            await firestoreBatch.commit();

            showMessage('Batch details updated successfully!', 'success');
            setShowEditBatchModal(false);
            setBatchToEditInModal(null);
            setShowHistoryModal(false); // Close history modal as data is now stale

        } catch (error) {
            console.error("Error updating batch details:", error);
            showMessage('Failed to update batch details.', 'error');
        }
    };
    
    // Handle deleting a transaction
    const handleDeleteTransaction = async (transaction) => {
        if (!db || !transaction || !transaction.id || !transaction.batchId) {
            showMessage("Invalid transaction data for deletion.", "error");
            return;
        }

        const recordRef = doc(db, `artifacts/${appId}/public/data/inventory_records`, transaction.id);
        const batchRef = doc(db, `artifacts/${appId}/public/data/batches`, transaction.batchId);

        try {
            const batchSnap = await getDoc(batchRef);
            if (!batchSnap.exists()) {
                await deleteDoc(recordRef);
                showMessage("Transaction deleted, but the associated batch was not found (it may have been deleted).", "error");
                setShowDeleteConfirmModal(false);
                setTransactionToDelete(null);
                return;
            }

            const batchData = batchSnap.data();
            const firestoreBatch = writeBatch(db);

            const quantityToRevert = transaction.quantity; // This is signed (+ for IN, - for OUT)
            const newCurrentQuantity = batchData.currentQuantity - quantityToRevert;

            if (newCurrentQuantity < 0) {
                 showMessage("Deletion failed: Cannot delete this 'IN' record because items have already been deducted from this batch, which would result in negative stock. Please reverse the deductions first.", "error");
                 setTransactionToDelete(null);
                 setShowDeleteConfirmModal(false);
                 return;
            }

            const updateData = { currentQuantity: newCurrentQuantity };
            if (transaction.type === 'IN') {
                updateData.initialQuantity = batchData.initialQuantity - quantityToRevert;
            }

            firestoreBatch.update(batchRef, updateData);
            firestoreBatch.delete(recordRef);

            await firestoreBatch.commit();
            showMessage("Transaction deleted successfully and batch stock adjusted.", "success");

        } catch (error) {
            console.error("Error deleting transaction:", error);
            showMessage("Failed to delete transaction.", "error");
        } finally {
            setShowDeleteConfirmModal(false);
            setTransactionToDelete(null);
        }
    };

    // Filter records based on multiple keywords
    const filterRecordsByKeywords = (records, query) => {
        const keywords = query.toLowerCase().split(' ').filter(kw => kw.trim() !== '');
        if (keywords.length === 0) return records;

        return records.filter(record => {
            // Construct a specific string for searching from relevant fields.
            // This prevents searching over noisy data like timestamps or internal IDs.
            // It works for both transaction records and aggregated stock reports.
            const searchableString = [
                record.category,
                record.grade,
                record.size,
                record.size1,
                record.size2,
                record.schedule,
                record.origin,
                record.seamCondition,
                record.location,
                record.entryBy, // Will be undefined for reports, filtered out by filter(Boolean)
                record.remarks,
            ].filter(Boolean).join(' ').toLowerCase();

            // Check if all keywords from the search query are present in the constructed string.
            // This is order-independent and robust.
            return keywords.every(keyword => searchableString.includes(keyword));
        });
    };

    // Sorted and Filtered inventory records for display
    const sortedAndFilteredInventoryRecords = useMemo(() => {
        const filtered = filterRecordsByKeywords(inventoryRecords, searchQuery);
        return filtered.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
    }, [inventoryRecords, searchQuery]);

    // Calculate current stock for reports (aggregated from batches)
    const currentStock = useMemo(() => {
        const stockMap = new Map();
        batches.forEach(batch => {
            const isDualSizeBatch = dualSizeCategories.includes(batch.category);
            const key = [
                batch.category, batch.grade,
                isDualSizeBatch ? batch.size1 || '' : batch.size || '',
                isDualSizeBatch ? batch.size2 || '' : '',
                batch.schedule, batch.origin, batch.seamCondition, batch.location
            ].join('|');

            const existing = stockMap.get(key);
            if (existing) {
                existing.quantity += batch.currentQuantity;
                if (batch.remarks && !existing.remarks.includes(batch.remarks)) {
                    existing.remarks.push(batch.remarks);
                }
            } else {
                stockMap.set(key, {
                    ...batch,
                    quantity: batch.currentQuantity,
                    remarks: batch.remarks ? [batch.remarks] : []
                });
            }
        });
        return Array.from(stockMap.values()).map(item => ({...item, remarks: item.remarks.join('; ')}));
    }, [batches]);

    // Get active batches matching the current form selection for OUT transactions
    const availableBatchesForOut = useMemo(() => {
        const { category, grade, size, size1, size2, schedule, origin, seamCondition, location } = formState;
        if (!category || !grade || !schedule || !origin || !seamCondition || !location) return [];
        const isDualSize = dualSizeCategories.includes(category);
        if ((isDualSize && (!size1 || !size2)) || (!isDualSize && !size)) return [];

        return batches.filter(batch => 
            batch.category === category &&
            batch.grade === grade &&
            batch.schedule === schedule &&
            batch.origin === origin &&
            batch.seamCondition === seamCondition &&
            batch.location === location &&
            batch.currentQuantity > 0 &&
            (isDualSize ? (batch.size1 === size1 && batch.size2 === size2) : (batch.size === size))
        ).sort((a, b) => (a.inDate || '').localeCompare(b.inDate || ''));
    }, [formState, batches]);

    // Calculate current stock for the selected combination in the IN/OUT form
    const currentStockForFormCombination = useMemo(() => {
        const { selectedBatchId } = formState;
        if (selectedBatchId) {
            return batches.find(b => b.id === selectedBatchId)?.currentQuantity ?? 'N/A';
        }
        return availableBatchesForOut.reduce((total, batch) => total + batch.currentQuantity, 0);
    }, [formState, batches, availableBatchesForOut]);

    // Filtered and sorted current stock for reports
    const filteredReportStock = useMemo(() => {
        const filtered = currentStock.filter(item => 
            (reportCategoryFilter === '' || item.category === reportCategoryFilter) &&
            (reportGradeFilter === '' || item.grade === reportGradeFilter) &&
            (reportScheduleFilter === '' || item.schedule === reportScheduleFilter) &&
            (reportOriginFilter === '' || item.origin === reportOriginFilter) &&
            (reportSeamConditionFilter === '' || item.seamCondition === reportSeamConditionFilter) &&
            (reportLocationFilter === '' || item.location === reportLocationFilter) &&
            (reportSizeFilter === '' || (dualSizeCategories.includes(item.category) ? (item.size1 === reportSizeFilter || item.size2 === reportSizeFilter) : item.size === reportSizeFilter))
        );
        const searchFiltered = filterRecordsByKeywords(filtered, searchQuery);
        return searchFiltered.sort((a, b) => a.category.localeCompare(b.category) || (a.size || a.size1).localeCompare(b.size || b.size1));
    }, [currentStock, reportCategoryFilter, reportGradeFilter, reportSizeFilter, reportScheduleFilter, reportOriginFilter, reportSeamConditionFilter, reportLocationFilter, searchQuery]);

    const handleViewHistory = (item) => {
        setSelectedItemForHistory(item);
        setShowHistoryModal(true);
    };

    const handleEditTransactionClick = (record) => {
        setTransactionToEdit(record);
        setShowEditTransactionModal(true);
    };

    const handleDeleteClick = (record) => {
        setTransactionToDelete(record);
        setShowDeleteConfirmModal(true);
    };

    const handleAdjustBatchClick = (batch) => {
        setBatchToAdjustInModal(batch);
        setShowAdjustBatchModal(true);
        setShowHistoryModal(false);
    };

    const handleTransferBatchClick = (batch) => {
        setBatchToTransferInModal(batch);
        setShowTransferBatchModal(true);
        setShowHistoryModal(false);
    };

    const handleEditBatchClick = (batch) => {
        setBatchToEditInModal(batch);
        setShowEditBatchModal(true);
        setShowHistoryModal(false);
    }

    const handleExportCsv = () => {
        if (filteredReportStock.length === 0) {
            showMessage('No data to export.', 'error');
            return;
        }
        const headers = ["Category", "Grade", "Size 1", "Size 2", "Schedule", "Origin", "Seam Condition", "Location", "Current Stock", "Remarks"];
        const rows = filteredReportStock.map(item => [
            item.category,
            item.grade,
            item.size1 || item.size || '',
            item.size2 || '',
            item.schedule,
            item.origin,
            item.seamCondition,
            item.location,
            item.quantity,
            item.remarks || ''
        ]);
        let csvContent = headers.join(',') + '\n' + rows.map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'inventory_report.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showMessage('Exported to CSV successfully!', 'success');
    };
    
    // Gemini API call for Report Summary
    const handleGenerateSummary = async () => {
        if (filteredReportStock.length === 0) {
            showMessage('No data to summarize. Please broaden your filters.', 'error');
            return;
        }
        setIsSummaryLoading(true);
        setReportSummary('');

        const dataForPrompt = filteredReportStock.map(item => ({
            item: `${item.category} ${item.grade} ${item.size1 || item.size || ''} ${item.size2 || ''}`,
            location: item.location,
            quantity: item.quantity
        }));

        const prompt = `As an expert inventory analyst for Rolex Fittings India Pvt Ltd, analyze the following current stock data and provide a concise, insightful summary in markdown format.

        Stock Data:
        ${JSON.stringify(dataForPrompt, null, 2)}

        Your summary should highlight:
        - The total number of unique items and total quantity across all locations.
        - The locations with the most and least items.
        - Any items with particularly high or low stock levels that might need attention.
        - A brief overview of stock distribution by category or grade, if any patterns are apparent.
        
        Keep the summary professional and easy to read.`;

        try {
            const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
            const payload = { contents: chatHistory };
            const apiKey = ""; // API key will be injected by the environment
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setReportSummary(text);
            } else {
                throw new Error("Invalid response structure from API.");
            }
        } catch (error) {
            console.error("Error generating report summary:", error);
            showMessage(`Failed to generate summary: ${error.message}`, 'error');
            setReportSummary("Sorry, an error occurred while generating the summary.");
        } finally {
            setIsSummaryLoading(false);
        }
    };


    if (!isAuthReady) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-xl font-semibold text-gray-700">Initializing Inventory System...</div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4 font-sans">
                <div className="w-full max-w-md bg-white shadow-lg rounded-xl p-6 text-center">
                    <h1 className="text-3xl font-extrabold text-gray-800 mb-4">INVENTORY SYSTEM</h1>
                    <h2 className="text-xl font-bold text-gray-700 mb-6">ROLEX FITTINGS INDIA PVT LTD</h2>
                    <p className="text-red-600 font-semibold mb-4">
                        <strong className="text-lg">SECURITY WARNING:</strong> This password is for demonstration only. Do NOT use this system for sensitive data in a real application.
                    </p>
                    <form onSubmit={handlePasswordSubmit} className="space-y-4">
                        <input
                            type="password"
                            value={passwordInput}
                            onChange={(e) => setPasswordInput(e.target.value)}
                            placeholder="Enter Access Password"
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                        />
                        {authError && <p className="text-red-500 text-sm">{authError}</p>}
                        <button
                            type="submit"
                            className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold text-lg hover:bg-blue-700 transition-colors duration-200 shadow-md"
                        >
                            Access Inventory
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 p-4 font-sans flex flex-col items-center">
            <div className="w-full max-w-7xl bg-white shadow-lg rounded-xl p-6 mb-8">
                <h1 className="text-4xl font-extrabold text-center text-gray-800 mb-2">INVENTORY SYSTEM</h1>
                <h2 className="text-2xl font-bold text-center text-gray-700 mb-6">ROLEX FITTINGS INDIA PVT LTD</h2>

                {message.text && (
                    <div className={`p-3 mb-4 rounded-lg text-center font-medium ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {message.text}
                    </div>
                )}

                <div className="flex justify-center mb-6 border-b">
                    <button onClick={() => setCurrentView('inventory')} className={`px-6 py-3 font-semibold transition-all duration-300 ${currentView === 'inventory' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-blue-500'}`}>
                        Inventory IN/OUT
                    </button>
                    <button onClick={() => setCurrentView('reports')} className={`px-6 py-3 font-semibold transition-all duration-300 ${currentView === 'reports' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-blue-500'}`}>
                        Reports
                    </button>
                </div>

                {currentView === 'inventory' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-blue-50 p-6 rounded-xl shadow-inner">
                            <h2 className="text-2xl font-bold text-blue-800 mb-4">Record Transaction</h2>
                            <div className="grid grid-cols-1 gap-4">
                                <InputField label="Entry By (Your Name)" id="entryBy" value={formState.entryBy} onChange={(v) => setFormState({...formState, entryBy: v})} placeholder="Enter your name" />
                                <SelectField label="Product Category" id="category" value={formState.category} onChange={(v) => setFormState({...formState, category: v, size: '', size1: '', size2: ''})} options={categories} placeholder="Select Category" onAddClick={() => setShowAddCategoryModal(true)} />
                                <SelectField label="Grade" id="grade" value={formState.grade} onChange={(v) => setFormState({...formState, grade: v})} options={grades} placeholder="Select Grade" onAddClick={() => setShowAddGradeModal(true)} />

                                {dualSizeCategories.includes(formState.category) ? (
                                    <>
                                        <SelectField label="Size 1" id="size1" value={formState.size1} onChange={(v) => setFormState({...formState, size1: v})} options={sizes} placeholder="Select Size 1" onAddClick={() => setShowAddSizeModal(true)} />
                                        <SelectField label="Size 2" id="size2" value={formState.size2} onChange={(v) => setFormState({...formState, size2: v})} options={sizes} placeholder="Select Size 2" onAddClick={() => setShowAddSizeModal(true)} />
                                    </>
                                ) : (
                                    <SelectField label="Size" id="size" value={formState.size} onChange={(v) => setFormState({...formState, size: v})} options={sizes} placeholder="Select Size" onAddClick={() => setShowAddSizeModal(true)} />
                                )}

                                <SelectField label="Schedule Thickness" id="schedule" value={formState.schedule} onChange={(v) => setFormState({...formState, schedule: v})} options={schedules} placeholder="Select Schedule" onAddClick={() => setShowAddScheduleModal(true)} />
                                <SelectField label="Origin" id="origin" value={formState.origin} onChange={(v) => setFormState({...formState, origin: v})} options={predefinedOrigins} placeholder="Select Origin" showAddButton={false} />
                                <SelectField label="Seam Condition" id="seamCondition" value={formState.seamCondition} onChange={(v) => setFormState({...formState, seamCondition: v})} options={predefinedSeamConditions} placeholder="Select Seam Condition" showAddButton={false} />
                                <SelectField label="Location" id="location" value={formState.location} onChange={(v) => setFormState({...formState, location: v})} options={locations} placeholder="Select Location" onAddClick={() => setShowAddLocationModal(true)} />

                                {availableBatchesForOut.length > 0 && (
                                    <div className="flex flex-col">
                                        <label htmlFor="selectBatch" className="text-gray-700 font-medium mb-1">Select Batch to Deduct From (for OUT)</label>
                                        <select
                                            id="selectBatch"
                                            value={formState.selectedBatchId}
                                            onChange={(e) => setFormState({...formState, selectedBatchId: e.target.value})}
                                            className="p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
                                        >
                                            <option value="">-- Select a specific batch --</option>
                                            {availableBatchesForOut.map((batch) => (
                                                <option key={batch.id} value={batch.id}>
                                                    IN: {batch.inDate} | Qty: {batch.currentQuantity}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <InputField label="Quantity" id="quantity" type="number" value={formState.quantity} onChange={(v) => setFormState({...formState, quantity: v})} placeholder="Enter quantity" />
                                <InputField label="Date" id="date" type="date" value={formState.date} onChange={(v) => setFormState({...formState, date: v})} />
                                
                                <div className="p-3 bg-blue-100 rounded-md text-blue-800 font-semibold text-center">
                                    Current Stock for this combination: {currentStockForFormCombination ?? '0'}
                                </div>

                                <InputField label="Remarks (Optional)" id="remarks" type="textarea" value={formState.remarks} onChange={(v) => setFormState({...formState, remarks: v})} rows="3" placeholder="Add any general comments here..." />

                                <div className="grid grid-cols-2 gap-4 mt-4">
                                    <button onClick={() => handleInventoryTransaction('IN')} className="col-span-1 bg-green-600 text-white py-3 rounded-lg font-bold text-lg hover:bg-green-700 transition-colors duration-200 shadow-md transform hover:scale-105">Inventory IN</button>
                                    <button onClick={() => handleInventoryTransaction('OUT')} className="col-span-1 bg-red-600 text-white py-3 rounded-lg font-bold text-lg hover:bg-red-700 transition-colors duration-200 shadow-md transform hover:scale-105">Inventory OUT</button>
                                    <div className="col-span-2">
                                        <button onClick={resetForm} className="w-full bg-gray-500 text-white py-2 rounded-lg font-semibold hover:bg-gray-600 transition-colors duration-200 shadow-md">Clear Form</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-md">
                            <h2 className="text-2xl font-bold text-gray-800 mb-2">Transaction Search</h2>
                            <p className="text-sm text-gray-500 mb-4">Double-click a row to quickly populate the form for a new transaction.</p>
                            <InputField type="text" placeholder="Search all transactions..." value={searchQuery} onChange={setSearchQuery} id="searchInventoryRecords" />
                            <div className="overflow-auto max-h-[600px] custom-scrollbar mt-4">
                                {sortedAndFilteredInventoryRecords.length > 0 ? (
                                    <table className="min-w-full bg-white border border-gray-200 rounded-lg text-sm">
                                        <thead className="bg-gray-100 sticky top-0">
                                            <tr>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Type</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Category</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Grade</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Size</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Sch</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Origin</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Seam</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Location</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Qty</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">By</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Remarks</th>
                                                <th className="p-2 border-b text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedAndFilteredInventoryRecords.map((record) => (
                                                <tr key={record.id} 
                                                    className="hover:bg-gray-50 transition-colors duration-150 cursor-pointer"
                                                    onDoubleClick={() => handleTransactionRowDoubleClick(record)}
                                                >
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{record.date}</td>
                                                    <td className={`p-2 border-b text-xs font-semibold whitespace-nowrap ${record.type === 'EDIT' ? 'text-yellow-600' : record.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{record.type}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{record.category}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{record.grade}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{dualSizeCategories.includes(record.category) ? `${record.size1 || ''}x${record.size2 || ''}` : record.size || ''}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{record.schedule}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{record.origin}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{record.seamCondition}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{record.location}</td>
                                                    <td className={`p-2 border-b text-xs text-center font-semibold ${record.type === 'EDIT' ? 'text-yellow-600' : record.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{record.type === 'EDIT' ? '-' : Math.abs(record.quantity)}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{record.entryBy}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap">{record.remarks || '-'}</td>
                                                    <td className="p-2 border-b text-xs text-gray-700 whitespace-nowrap space-x-1">
                                                        {record.type !== 'EDIT' && (
                                                            <button onClick={() => handleEditTransactionClick(record)} className="px-2 py-1 bg-blue-500 text-white rounded-md text-xs hover:bg-blue-600">
                                                                Edit
                                                            </button>
                                                        )}
                                                        <button onClick={() => handleDeleteClick(record)} className="px-2 py-1 bg-red-600 text-white rounded-md text-xs hover:bg-red-700">
                                                            Delete
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <p className="text-center text-gray-500 py-8">No inventory records found.</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {currentView === 'reports' && (
                    <div className="bg-white p-6 rounded-xl shadow-md">
                        <h2 className="text-2xl font-bold text-gray-800 mb-4">Current Stock Report</h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-4 items-end">
                            <SelectField label="Category" id="reportCategoryFilter" value={reportCategoryFilter} onChange={setReportCategoryFilter} options={['', ...categories]} placeholder="All" showAddButton={false} />
                            <SelectField label="Grade" id="reportGradeFilter" value={reportGradeFilter} onChange={setReportGradeFilter} options={['', ...grades]} placeholder="All" showAddButton={false} />
                            <SelectField label="Size" id="reportSizeFilter" value={reportSizeFilter} onChange={setReportSizeFilter} options={['', ...sizes]} placeholder="All" showAddButton={false} />
                            <SelectField label="Schedule" id="reportScheduleFilter" value={reportScheduleFilter} onChange={setReportScheduleFilter} options={['', ...schedules]} placeholder="All" showAddButton={false} />
                            <SelectField label="Origin" id="reportOriginFilter" value={reportOriginFilter} onChange={setReportOriginFilter} options={['', ...predefinedOrigins]} placeholder="All" showAddButton={false} />
                            <SelectField label="Seam" id="reportSeamConditionFilter" value={reportSeamConditionFilter} onChange={setReportSeamConditionFilter} options={['', ...predefinedSeamConditions]} placeholder="All" showAddButton={false} />
                            <SelectField label="Location" id="reportLocationFilter" value={reportLocationFilter} onChange={setReportLocationFilter} options={['', ...locations]} placeholder="All" showAddButton={false} />
                            <div className="flex space-x-2">
                                <button onClick={handleExportCsv} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors duration-200 shadow-md h-10">Export CSV</button>
                                <button onClick={handleGenerateSummary} disabled={isSummaryLoading} className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition-colors duration-200 shadow-md h-10 disabled:bg-purple-300 disabled:cursor-not-allowed">
                                    {isSummaryLoading ? 'Generating...' : '✨ Generate Summary'}
                                </button>
                            </div>
                        </div>
                        
                        {(isSummaryLoading || reportSummary) && (
                            <div className="my-4 p-4 border rounded-lg bg-gray-50">
                                <h3 className="text-lg font-bold text-purple-800 mb-2">AI Report Summary</h3>
                                {isSummaryLoading && <div className="text-center p-4"> <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-700 mx-auto"></div> <p className="mt-2">Generating insights...</p> </div>}
                                {reportSummary && <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: reportSummary.replace(/\n/g, '<br />') }}></div>}
                            </div>
                        )}

                        <InputField type="text" placeholder="Search current stock..." value={searchQuery} onChange={setSearchQuery} id="searchCurrentStock" />
                        <div className="overflow-auto max-h-[600px] custom-scrollbar mt-4">
                            {filteredReportStock.length > 0 ? (
                                <table className="min-w-full bg-white border border-gray-200 rounded-lg">
                                    <thead className="bg-gray-100 sticky top-0">
                                        <tr>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Category</th>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Grade</th>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Size 1</th>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Size 2</th>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Schedule</th>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Origin</th>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Seam</th>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Location</th>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Current Stock</th>
                                            <th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Remarks</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredReportStock.map((item, index) => (
                                            <tr key={index} className="hover:bg-gray-50 transition-colors duration-150 cursor-pointer" onClick={() => handleViewHistory(item)}>
                                                <td className="py-2 px-4 border-b text-sm text-gray-800">{item.category}</td>
                                                <td className="py-2 px-4 border-b text-sm text-gray-800">{item.grade}</td>
                                                <td className="py-2 px-4 border-b text-sm text-gray-800">{item.size1 || item.size || '-'}</td>
                                                <td className="py-2 px-4 border-b text-sm text-gray-800">{item.size2 || '-'}</td>
                                                <td className="py-2 px-4 border-b text-sm text-gray-800">{item.schedule}</td>
                                                <td className="py-2 px-4 border-b text-sm text-gray-800">{item.origin}</td>
                                                <td className="py-2 px-4 border-b text-sm text-gray-800">{item.seamCondition}</td>
                                                <td className="py-2 px-4 border-b text-sm text-gray-800">{item.location}</td>
                                                <td className={`py-2 px-4 border-b text-sm font-semibold ${item.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{item.quantity}</td>
                                                <td className="py-2 px-4 border-b text-sm text-gray-800">{item.remarks || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <p className="text-center text-gray-500 py-8">No current stock found matching your filters.</p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {showAddCategoryModal && <Modal title="Add New Product Category" value={newCategoryName} onChange={setNewCategoryName} onSave={() => handleAddMasterData('categories', 'Category', newCategoryName, setShowAddCategoryModal, setNewCategoryName)} onClose={() => setShowAddCategoryModal(false)} />}
            {showAddGradeModal && <Modal title="Add New Grade" value={newGradeName} onChange={setNewGradeName} onSave={() => handleAddMasterData('grades', 'Grade', newGradeName, setShowAddGradeModal, setNewGradeName)} onClose={() => setShowAddGradeModal(false)} />}
            {showAddSizeModal && <Modal title="Add New Size" value={newSizeName} onChange={setNewSizeName} onSave={() => handleAddMasterData('sizes', 'Size', newSizeName, setShowAddSizeModal, setNewSizeName)} onClose={() => setShowAddSizeModal(false)} />}
            {showAddScheduleModal && <Modal title="Add New Schedule Thickness" value={newScheduleName} onChange={setNewScheduleName} onSave={() => handleAddMasterData('schedules', 'Schedule', newScheduleName, setShowAddScheduleModal, setNewScheduleName)} onClose={() => setShowAddScheduleModal(false)} />}
            {showAddLocationModal && <Modal title="Add New Location" value={newLocationName} onChange={setNewLocationName} onSave={() => handleAddMasterData('locations', 'Location', newLocationName, setShowAddLocationModal, setNewLocationName)} onClose={() => setShowAddLocationModal(false)} />}
            
            {showHistoryModal && selectedItemForHistory && <HistoryModal item={selectedItemForHistory} inventoryRecords={inventoryRecords} batches={batches} onClose={() => setShowHistoryModal(false)} onAdjustBatchClick={handleAdjustBatchClick} onTransferBatchClick={handleTransferBatchClick} onEditBatchClick={handleEditBatchClick} dualSizeCategories={dualSizeCategories} showMessage={showMessage} />}
            {showAdjustBatchModal && batchToAdjustInModal && <AdjustBatchModal batchToAdjust={batchToAdjustInModal} onClose={() => setShowAdjustBatchModal(false)} onSaveAdjustment={handleSaveAdjustment} entryBy={formState.entryBy} dualSizeCategories={dualSizeCategories} />}
            {showTransferBatchModal && batchToTransferInModal && <TransferBatchModal batchToTransfer={batchToTransferInModal} onClose={() => setShowTransferBatchModal(false)} onSaveTransfer={handleSaveTransfer} entryBy={formState.entryBy} locations={locations} dualSizeCategories={dualSizeCategories} />}
            {showEditTransactionModal && transactionToEdit && <EditTransactionModal transaction={transactionToEdit} onSave={handleUpdateTransaction} onClose={() => setShowEditTransactionModal(false)} dualSizeCategories={dualSizeCategories} />}
            {showEditBatchModal && batchToEditInModal && <EditBatchModal batchToEdit={batchToEditInModal} onSave={handleSaveBatchEdit} onClose={() => setShowEditBatchModal(false)} masterData={{categories, grades, sizes, schedules, locations, predefinedOrigins, predefinedSeamConditions}} dualSizeCategories={dualSizeCategories} />}
            {showDeleteConfirmModal && <DeleteConfirmModal transaction={transactionToDelete} onConfirm={handleDeleteTransaction} onClose={() => setShowDeleteConfirmModal(false)} dualSizeCategories={dualSizeCategories} />}

            <style>{`.custom-scrollbar::-webkit-scrollbar{width:8px;height:8px}.custom-scrollbar::-webkit-scrollbar-track{background:#f1f1f1;border-radius:10px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#888;border-radius:10px}.custom-scrollbar::-webkit-scrollbar-thumb:hover{background:#555}.prose{color:#374151}.prose h1,.prose h2,.prose h3,.prose h4{color:#1f2937;font-weight:600}.prose strong{color:#1f2937;font-weight:600}.prose ul{list-style-type:disc;padding-left:1.5rem}.prose li{margin-top:0.25rem;margin-bottom:0.25rem}`}</style>
        </div>
    );
}

const Modal = ({ title, value, onChange, onSave, onClose }) => (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="text-2xl font-bold text-gray-800 mb-4">{title}</h3>
            <InputField id="newItemName" value={value} onChange={onChange} placeholder="Enter new name" />
            <div className="flex justify-end space-x-3 mt-4">
                <button type="button" onClick={onClose} className="px-5 py-2 bg-gray-300 text-gray-800 rounded-lg font-semibold hover:bg-gray-400">Cancel</button>
                <button type="button" onClick={onSave} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">Save</button>
            </div>
        </div>
    </div>
);

const DeleteConfirmModal = ({ transaction, onConfirm, onClose, dualSizeCategories }) => {
    if (!transaction) return null;
    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg">
                <h3 className="text-2xl font-bold text-red-700 mb-4">Confirm Deletion</h3>
                <p className="text-md text-gray-800 mb-2">Are you sure you want to permanently delete this transaction?</p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm">
                    <p><strong>Type:</strong> <span className={`font-semibold ${transaction.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{transaction.type}</span></p>
                    <p><strong>Date:</strong> {transaction.date}</p>
                    <p><strong>Item:</strong> {`${transaction.category} | ${transaction.grade} | ${dualSizeCategories.includes(transaction.category) ? `${transaction.size1 || ''}x${transaction.size2 || ''}` : transaction.size || ''}`}</p>
                    <p><strong>Quantity:</strong> {Math.abs(transaction.quantity)}</p>
                </div>
                <p className="text-red-600 font-semibold mb-4">
                    <strong>Warning:</strong> This action will adjust the corresponding batch's stock quantity and cannot be undone.
                </p>
                <div className="flex justify-end space-x-3 mt-6">
                    <button type="button" onClick={onClose} className="px-5 py-2 bg-gray-300 text-gray-800 rounded-lg font-semibold hover:bg-gray-400">Cancel</button>
                    <button type="button" onClick={() => onConfirm(transaction)} className="px-5 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700">Confirm Delete</button>
                </div>
            </div>
        </div>
    );
};

const EditTransactionModal = ({ transaction, onSave, onClose, dualSizeCategories }) => {
    const [editState, setEditState] = useState({ ...transaction });

    const handleSave = () => {
        // Pass the updated state and the original transaction back to the parent
        onSave(editState, transaction);
    };

    const isOut = transaction.type === 'OUT' || transaction.type === 'TRANSFER_OUT';
    const quantityToEdit = isOut ? Math.abs(editState.quantity) : editState.quantity;
    
    const handleQuantityChange = (val) => {
        const newAbsQty = Math.abs(parseInt(val, 10)) || 0;
        setEditState({
            ...editState,
            quantity: isOut ? -newAbsQty : newAbsQty
        });
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg">
                <h3 className="text-2xl font-bold text-gray-800 mb-4">Edit Transaction</h3>
                <div className="space-y-4">
                    <p className="text-md text-gray-700">
                        <strong>Item:</strong> {`${transaction.category} | ${transaction.grade} | ${dualSizeCategories.includes(transaction.category) ? `${transaction.size1 || ''}x${transaction.size2 || ''}` : transaction.size || ''}`}
                    </p>
                     <p className="text-md text-gray-700">
                        <strong>Type:</strong> <span className={`font-semibold ${transaction.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{transaction.type}</span>
                    </p>
                    <InputField label="Quantity" id="editQuantity" type="number" value={quantityToEdit} onChange={handleQuantityChange} />
                    <InputField label="Date" id="editDate" type="date" value={editState.date} onChange={(v) => setEditState({...editState, date: v})} />
                    <InputField label="Remarks" id="editRemarks" type="textarea" rows="3" value={editState.remarks} onChange={(v) => setEditState({...editState, remarks: v})} />
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                    <button type="button" onClick={onClose} className="px-5 py-2 bg-gray-300 text-gray-800 rounded-lg font-semibold hover:bg-gray-400">Cancel</button>
                    <button type="button" onClick={handleSave} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">Save Changes</button>
                </div>
            </div>
        </div>
    );
};


const HistoryModal = ({ item, inventoryRecords, batches, onClose, onAdjustBatchClick, onTransferBatchClick, onEditBatchClick, dualSizeCategories, showMessage }) => {
    const [reorderSuggestion, setReorderSuggestion] = useState('');
    const [isSuggestionLoading, setIsSuggestionLoading] = useState(false);

    const itemHistory = useMemo(() => inventoryRecords.filter(record => 
        record.category === item.category &&
        record.grade === item.grade &&
        (dualSizeCategories.includes(item.category) ? (record.size1 === item.size1 && record.size2 === item.size2) : record.size === item.size) &&
        record.schedule === item.schedule &&
        record.origin === item.origin &&
        record.seamCondition === item.seamCondition &&
        record.location === item.location
    ).sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0)), [inventoryRecords, item, dualSizeCategories]);

    const associatedBatches = useMemo(() => batches.filter(batch =>
        batch.category === item.category &&
        batch.grade === item.grade &&
        (dualSizeCategories.includes(item.category) ? (batch.size1 === item.size1 && batch.size2 === item.size2) : batch.size === item.size) &&
        batch.schedule === item.schedule &&
        batch.origin === item.origin &&
        batch.seamCondition === item.seamCondition &&
        batch.location === item.location
    ).sort((a, b) => (a.inDate || '').localeCompare(b.inDate || '')), [batches, item, dualSizeCategories]);
    
    const handleSuggestReorder = async () => {
        setIsSuggestionLoading(true);
        setReorderSuggestion('');

        const historyForPrompt = itemHistory.map(rec => ({ date: rec.date, type: rec.type, quantity: rec.quantity }));
        const prompt = `As an expert inventory analyst for Rolex Fittings India Pvt Ltd, analyze the following item's transaction history and current stock level. Provide a concise reorder suggestion.

        Item: ${item.category} ${item.grade} ${item.size1 || item.size || ''} ${item.size2 || ''}
        Location: ${item.location}
        Current Stock: ${item.quantity}

        Transaction History (last 90 days):
        ${JSON.stringify(historyForPrompt, null, 2)}

        Based on the consumption rate (OUT transactions), advise whether a reorder is needed. Consider the current stock level. Be brief and direct in your recommendation. For example: "Recommendation: Reorder now. Stock is low and consumption is steady." or "Recommendation: No reorder needed at this time. Stock levels are adequate."`;

        try {
            const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
            const payload = { contents: chatHistory };
            const apiKey = ""; // API key will be injected by the environment
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
            
            const result = await response.json();

            if (result.candidates && result.candidates.length > 0 && result.candidates[0].content?.parts?.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setReorderSuggestion(text);
            } else {
                throw new Error("Invalid response structure from API.");
            }
        } catch (error) {
            console.error("Error generating reorder suggestion:", error);
            showMessage(`Failed to get suggestion: ${error.message}`, 'error');
            setReorderSuggestion("Sorry, an error occurred while generating the suggestion.");
        } finally {
            setIsSuggestionLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-4xl">
                <div className="flex justify-between items-start">
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800 mb-2">History for:</h3>
                        <p className="text-lg font-medium text-gray-700 mb-4">{`${item.category} | ${item.grade} | ${dualSizeCategories.includes(item.category) ? `${item.size1 || ''}x${item.size2 || ''}` : item.size || ''} | ${item.schedule} | ${item.location}`}</p>
                    </div>
                    <button onClick={onClose} className="p-2 -mt-2 -mr-2 text-gray-500 hover:text-gray-800">&times;</button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <h4 className="text-xl font-bold text-gray-700 mb-3">Associated Batches</h4>
                        <div className="overflow-auto max-h-[150px] custom-scrollbar mb-4 border rounded-lg">
                            {associatedBatches.length > 0 ? (
                                <table className="min-w-full bg-white">
                                    <thead className="bg-gray-100 sticky top-0"><tr><th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">IN Date</th><th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Initial</th><th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Current</th><th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Actions</th></tr></thead>
                                    <tbody>{associatedBatches.map(batch => (<tr key={batch.id} className={`hover:bg-gray-50 ${batch.currentQuantity === 0 ? 'opacity-50' : ''}`}><td className="py-2 px-4 border-b text-sm">{batch.inDate}</td><td className="py-2 px-4 border-b text-sm">{batch.initialQuantity}</td><td className="py-2 px-4 border-b text-sm font-semibold text-blue-600">{batch.currentQuantity}</td><td className="py-2 px-4 border-b text-sm space-x-2"><button onClick={() => onEditBatchClick(batch)} className="px-3 py-1 bg-blue-500 text-white rounded-md text-xs hover:bg-blue-600">Edit</button><button onClick={() => onAdjustBatchClick(batch)} className="px-3 py-1 bg-yellow-500 text-white rounded-md text-xs hover:bg-yellow-600">Adjust</button><button onClick={() => onTransferBatchClick(batch)} className="px-3 py-1 bg-indigo-500 text-white rounded-md text-xs hover:bg-indigo-600">Transfer</button></td></tr>))}</tbody>
                                </table>
                            ) : <p className="text-center text-gray-500 py-4">No batches found.</p>}
                        </div>
                    </div>
                    <div>
                        <h4 className="text-xl font-bold text-gray-700 mb-3">AI Reorder Suggestion</h4>
                        <div className="p-4 border rounded-lg bg-purple-50">
                            <button onClick={handleSuggestReorder} disabled={isSuggestionLoading} className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition-colors duration-200 shadow-md disabled:bg-purple-300 disabled:cursor-not-allowed">
                                {isSuggestionLoading ? 'Analyzing...' : '✨ Suggest Reorder'}
                            </button>
                            {isSuggestionLoading && <div className="text-center p-4"> <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-700 mx-auto"></div> <p className="mt-2 text-sm">Analyzing consumption rate...</p> </div>}
                            {reorderSuggestion && <div className="mt-3 prose prose-sm max-w-none text-purple-900" dangerouslySetInnerHTML={{ __html: reorderSuggestion.replace(/\n/g, '<br />') }}></div>}
                        </div>
                    </div>
                </div>

                <h4 className="text-xl font-bold text-gray-700 mt-6 mb-3">Transaction History</h4>
                <div className="overflow-auto max-h-[250px] custom-scrollbar mb-4 border rounded-lg">
                    {itemHistory.length > 0 ? (
                        <table className="min-w-full bg-white">
                            <thead className="bg-gray-100 sticky top-0"><tr><th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Date</th><th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Type</th><th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Qty</th><th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">By</th><th className="py-2 px-4 border-b text-left text-sm font-semibold text-gray-600">Remarks</th></tr></thead>
                            <tbody>{itemHistory.map(record => (<tr key={record.id}><td className="py-2 px-4 border-b text-sm">{record.date}</td><td className={`py-2 px-4 border-b text-sm font-semibold ${record.type === 'EDIT' ? 'text-yellow-600' : record.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{record.type}</td><td className={`py-2 px-4 border-b text-sm font-semibold ${record.type === 'EDIT' ? 'text-yellow-600' : record.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>{record.type === 'EDIT' ? '-' : Math.abs(record.quantity)}</td><td className="py-2 px-4 border-b text-sm">{record.entryBy || '-'}</td><td className="py-2 px-4 border-b text-sm">{record.remarks || '-'}</td></tr>))}</tbody>
                        </table>
                    ) : <p className="text-center text-gray-500 py-4">No transaction history found.</p>}
                </div>
                <div className="flex justify-end"><button onClick={onClose} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">Close</button></div>
            </div>
        </div>
    );
};

const AdjustBatchModal = ({ batchToAdjust, onClose, onSaveAdjustment, entryBy, dualSizeCategories }) => {
    const [adjQty, setAdjQty] = useState('');
    const [adjRemarks, setAdjRemarks] = useState('');
    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
                <h3 className="text-2xl font-bold text-gray-800 mb-4">Adjust Batch Quantity</h3>
                <p className="text-md text-gray-700 mb-4">{`Item: ${batchToAdjust.category} | ${batchToAdjust.grade} | ${dualSizeCategories.includes(batchToAdjust.category) ? `${batchToAdjust.size1 || ''}x${batchToAdjust.size2 || ''}` : batchToAdjust.size || ''} | ${batchToAdjust.location}`}</p>
                <p className="text-lg font-semibold text-blue-700 mb-4">Current Quantity: {batchToAdjust.currentQuantity}</p>
                <div className="grid grid-cols-1 gap-4 mb-4">
                    <InputField label="Adjustment Quantity (+/-)" id="adjQuantity" type="number" value={adjQty} onChange={setAdjQty} placeholder="e.g., -5 or 10" />
                    <InputField label="Adjustment Remarks" id="adjRemarks" type="textarea" value={adjRemarks} onChange={setAdjRemarks} rows="3" placeholder="Reason for adjustment" />
                </div>
                <div className="flex justify-end space-x-3"><button onClick={onClose} className="px-5 py-2 bg-gray-300 text-gray-800 rounded-lg font-semibold hover:bg-gray-400">Cancel</button><button onClick={() => onSaveAdjustment(batchToAdjust.id, parseInt(adjQty), adjRemarks)} className="px-5 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700">Save Adjustment</button></div>
            </div>
        </div>
    );
};

const TransferBatchModal = ({ batchToTransfer, onClose, onSaveTransfer, entryBy, locations, dualSizeCategories }) => {
    const [transferQty, setTransferQty] = useState('');
    const [destLocation, setDestLocation] = useState('');
    const [transferRemarks, setTransferRemarks] = useState('');
    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
                <h3 className="text-2xl font-bold text-gray-800 mb-4">Transfer Batch</h3>
                <p className="text-md text-gray-700 mb-4">{`Item: ${batchToTransfer.category} | ${batchToTransfer.grade} | ${dualSizeCategories.includes(batchToTransfer.category) ? `${batchToTransfer.size1 || ''}x${batchToTransfer.size2 || ''}` : batchToTransfer.size || ''}`}</p>
                <p className="text-lg font-semibold text-blue-700 mb-4">{`Current at ${batchToTransfer.location}: ${batchToTransfer.currentQuantity}`}</p>
                <div className="grid grid-cols-1 gap-4 mb-4">
                    <SelectField label="Destination Location" id="transferDest" value={destLocation} onChange={setDestLocation} options={locations.filter(loc => loc !== batchToTransfer.location)} placeholder="Select Destination" showAddButton={false} />
                    <InputField label="Quantity to Transfer" id="transferQty" type="number" value={transferQty} onChange={setTransferQty} placeholder="Enter quantity" />
                    <InputField label="Transfer Remarks" id="transferRemarks" type="textarea" value={transferRemarks} onChange={setTransferRemarks} rows="3" placeholder="Reason for transfer" />
                </div>
                <div className="flex justify-end space-x-3"><button onClick={onClose} className="px-5 py-2 bg-gray-300 rounded-lg font-semibold hover:bg-gray-400">Cancel</button><button onClick={() => onSaveTransfer(batchToTransfer.id, destLocation, parseInt(transferQty), transferRemarks)} className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700">Initiate Transfer</button></div>
            </div>
        </div>
    );
};

const EditBatchModal = ({ batchToEdit, onSave, onClose, masterData, dualSizeCategories }) => {
    const [editState, setEditState] = useState({ ...batchToEdit });
    const [editRemarks, setEditRemarks] = useState('');

    const handleSave = () => {
        const { id, timestamp, initialQuantity, currentQuantity, inDate, entryBy, ...originalData } = batchToEdit;
        const { id: updatedId, timestamp: updatedTimestamp, ...updatedData } = editState;
        
        onSave(batchToEdit.id, updatedData, originalData, editRemarks);
    };

    const isDual = dualSizeCategories.includes(editState.category);

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl">
                <h3 className="text-2xl font-bold text-gray-800 mb-4">Edit Batch Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto custom-scrollbar p-2">
                    <SelectField label="Product Category" id="editCategory" value={editState.category} onChange={(v) => setEditState({...editState, category: v, size: '', size1: '', size2: ''})} options={masterData.categories} placeholder="Select Category" showAddButton={false} />
                    <SelectField label="Grade" id="editGrade" value={editState.grade} onChange={(v) => setEditState({...editState, grade: v})} options={masterData.grades} placeholder="Select Grade" showAddButton={false} />
                    
                    {isDual ? (
                        <>
                            <SelectField label="Size 1" id="editSize1" value={editState.size1} onChange={(v) => setEditState({...editState, size1: v})} options={masterData.sizes} placeholder="Select Size 1" showAddButton={false} />
                            <SelectField label="Size 2" id="editSize2" value={editState.size2} onChange={(v) => setEditState({...editState, size2: v})} options={masterData.sizes} placeholder="Select Size 2" showAddButton={false} />
                        </>
                    ) : (
                        <SelectField label="Size" id="editSize" value={editState.size} onChange={(v) => setEditState({...editState, size: v})} options={masterData.sizes} placeholder="Select Size" showAddButton={false} />
                    )}

                    <SelectField label="Schedule Thickness" id="editSchedule" value={editState.schedule} onChange={(v) => setEditState({...editState, schedule: v})} options={masterData.schedules} placeholder="Select Schedule" showAddButton={false} />
                    <SelectField label="Origin" id="editOrigin" value={editState.origin} onChange={(v) => setEditState({...editState, origin: v})} options={masterData.predefinedOrigins} placeholder="Select Origin" showAddButton={false} />
                    <SelectField label="Seam Condition" id="editSeam" value={editState.seamCondition} onChange={(v) => setEditState({...editState, seamCondition: v})} options={masterData.predefinedSeamConditions} placeholder="Select Seam" showAddButton={false} />
                    <SelectField label="Location" id="editLocation" value={editState.location} onChange={(v) => setEditState({...editState, location: v})} options={masterData.locations} placeholder="Select Location" showAddButton={false} />
                    
                    <div className="md:col-span-2">
                        <InputField label="Reason for Edit (Remarks)" id="editBatchRemarks" type="textarea" value={editRemarks} onChange={setEditRemarks} rows="3" placeholder="Explain why this change is being made" />
                    </div>
                </div>
                <div className="flex justify-end space-x-3 mt-6">
                    <button type="button" onClick={onClose} className="px-5 py-2 bg-gray-300 text-gray-800 rounded-lg font-semibold hover:bg-gray-400">Cancel</button>
                    <button type="button" onClick={handleSave} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">Save Changes</button>
                </div>
            </div>
        </div>
    );
};

export default App;
